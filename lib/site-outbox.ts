'use client';
// Site outbox for low-network areas: a save (with its photos) is kept on the phone in IndexedDB
// and sent when the connection is back — automatically on reconnect and every 30 seconds.
// Each save carries its own request id, so sending it twice never saves twice.
import { useEffect, useState } from 'react';
import { siteCall, SiteCallError } from './site-client';

export type OutboxItem = { id: string; action: string; payload: any; label: string; createdAt: string; tries: number; error?: string; failed?: boolean };
const DB = 'bilara-site-outbox', STORE = 'items';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), r = run(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export const outboxItems = () => tx<OutboxItem[]>('readonly', (s) => s.getAll() as any).catch(() => [] as OutboxItem[]);
const put = (item: OutboxItem) => tx('readwrite', (s) => s.put(item));
export const discard = (id: string) => tx('readwrite', (s) => s.delete(id)).then(notify);

const listeners = new Set<() => void>();
function notify() { listeners.forEach((f) => f()); }

/**
 * Send now; if the server cannot be reached, keep it in the outbox and send later.
 * Returns {sent:true, value} or {queued:true}. A rejection by the server (wrong data) is thrown.
 */
export async function sendOrKeep(action: string, payload: any, label: string): Promise<{ sent?: boolean; queued?: boolean; value?: any }> {
  try {
    return { sent: true, value: await siteCall(action, payload) };
  } catch (e) {
    if (!(e instanceof SiteCallError) || !e.offline) throw e;
    await put({ id: String(payload.clientRequestId || crypto.randomUUID()), action, payload, label, createdAt: new Date().toISOString(), tries: 1, error: e.message });
    notify();
    return { queued: true };
  }
}

let flushing = false;
export async function flushOutbox(onSent?: (item: OutboxItem, value: any) => void) {
  if (flushing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  flushing = true;
  try {
    for (const item of await outboxItems()) {
      if (item.failed) continue;
      try {
        const value = await siteCall(item.action, item.payload);
        await discard(item.id);
        onSent?.(item, value);
      } catch (e) {
        const offline = e instanceof SiteCallError && e.offline;
        await put({ ...item, tries: item.tries + 1, error: e instanceof Error ? e.message : String(e), failed: !offline });
        if (offline) break;
      }
    }
  } finally {
    flushing = false;
    notify();
  }
}

/** Items waiting on this phone; sends them when the network is back. */
export function useOutbox(onSent?: (item: OutboxItem, value: any) => void) {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    const load = () => { outboxItems().then(setItems); };
    listeners.add(load);
    load();
    const go = () => flushOutbox(onSent);
    go();
    window.addEventListener('online', go);
    const timer = setInterval(go, 30000);
    return () => { listeners.delete(load); window.removeEventListener('online', go); clearInterval(timer); };
  }, []);
  return items;
}
