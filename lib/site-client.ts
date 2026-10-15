'use client';
// Browser side of the site pages (converted from the QC app's Index.html helpers):
// one call to /api/site, request ids for retry-safe saves, and photo compression.

export class SiteCallError extends Error {}

/** Call a site action, as the QC app's google.script.run apiCall(action, args) did. */
export async function siteCall<T = any>(action: string, ...args: any[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/site', {
      method: 'POST',
      signal: AbortSignal.timeout(120000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args }),
    });
  } catch (e) {
    throw new SiteCallError(
      e instanceof DOMException && e.name === 'TimeoutError'
        ? 'The server took too long to answer. Check your connection, refresh and try again; nothing is saved twice.'
        : 'Could not reach the server. Check your connection and try again.',
    );
  }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new SiteCallError(String(data.error || 'The action could not be completed.'));
  return data.value as T;
}

/** A new id for one save; retries with the same id never save twice. */
export function requestId(prefix = 'WEB') {
  return prefix + '-' + (globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2));
}

export const istToday = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const addDays = (key: string, n: number) => {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const niceDate = (key: string) =>
  key
    ? new Date(key + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    : '';
export const fmt = (n: any, digits = 2) => {
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v * 10 ** digits) / 10 ** digits) : '';
};
export const titleCase = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export type PhotoData = { name: string; mimeType: string; data: string };

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The photo could not be read.'));
    r.readAsDataURL(blob);
  });
}

/**
 * Photos as the server expects them: shrunk to at most 1800 px and JPEG 82% when large
 * (same as the QC app), otherwise sent as taken.
 */
export async function photoData(files: File[], limitBytes = 25 * 1024 * 1024): Promise<PhotoData[]> {
  const out: PhotoData[] = [];
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) throw new SiteCallError(file.name + ' is larger than 20 MB.');
    let item: PhotoData | null = null;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as any);
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      if (scale < 1 || file.size > 2 * 1024 * 1024) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Photo compression failed.'))), 'image/jpeg', 0.82),
        );
        item = { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg', data: await readAsDataUrl(blob) };
      }
      (bitmap as any).close?.();
    } catch {
      if (file.size > 10 * 1024 * 1024) throw new SiteCallError(file.name + ' could not be compressed and is larger than 10 MB.');
    }
    if (!item) item = { name: file.name, mimeType: file.type, data: await readAsDataUrl(file) };
    out.push(item);
  }
  const total = out.reduce((sum, p) => sum + Math.ceil(p.data.length * 0.75), 0);
  if (total > limitBytes) throw new SiteCallError('The selected photos are too large together. Upload fewer photos or reduce their size.');
  return out;
}

/** Site role of a purchasing-app user (one role per person). */
export function siteRoleOf(roles: string[]): string {
  const map: Record<string, string> = {
    'Super Admin': 'ADMIN', GM: 'GM', 'Project Manager': 'PM', 'Site Engineer': 'SITE_ENGINEER', QC: 'QC',
    'Purchase Manager': 'PURCHASE', 'Purchase Team': 'PURCHASE', Audit: 'AUDITOR', 'Labour Manager': 'LABOR_MANAGER', HR: 'HR', Contractor: 'CONTRACTOR',
  };
  for (const r of roles || []) if (map[r]) return map[r];
  return '';
}
