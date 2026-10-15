// Photo and document storage for the site pages (replaces the QC app's Google Drive folders).
// A "folder" is a key prefix in the app's R2 bucket; its URL opens the in-app photo list.
import {documentStorage} from '@/lib/documents';
import {SiteError, formatDate} from './core';

export const PHOTO_TYPES: Record<string, string> = {jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif'};
export const ALLOWED_PHOTO_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

export function safeName(value: any, fallback: string): string {
  const name = String(value || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
  return name || fallback;
}

export type DecodedFile = {bytes: Uint8Array; mimeType: string; name: string};

/** A browser data URL (data:image/jpeg;base64,...) checked and decoded. */
export function decodeDataUrl(file: any, label: string, allowed: string[], maxBytes: number): DecodedFile {
  if (!file || !file.data) throw new SiteError(label + ' is empty. Select the file again.');
  const extension = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  const inferred = extension && PHOTO_TYPES[extension[1]];
  const mime = String(file.mimeType || inferred || '').trim().toLowerCase();
  if (allowed.indexOf(mime) < 0) throw new SiteError(label + ' must be a JPEG, PNG, WebP or HEIC image.');
  const match = String(file.data).match(/^data:[^;]+;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new SiteError(label + ' could not be read. Select the file again.');
  const bin = atob(match[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (!bytes.length || bytes.length > maxBytes) throw new SiteError(label + ' must be smaller than ' + Math.round(maxBytes / 1024 / 1024) + ' MB.');
  return {bytes, mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime, name: safeName(file.name, label + '.jpg')};
}

/** In-app link that lists the files under a prefix. */
export function folderUrl(prefix: string): string {
  return '/site?files=' + encodeURIComponent(prefix);
}

/** Store files under a prefix; returns their keys. */
export async function storeFiles(prefix: string, files: DecodedFile[], filePrefix: string, now: Date): Promise<string[]> {
  const storage = documentStorage();
  const keys: string[] = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const stamp = formatDate(now, 'HHmmss');
      const key = prefix + '/' + safeName(filePrefix + '-' + stamp + '-' + String(i + 1).padStart(2, '0') + '-' + files[i].name, filePrefix + '.jpg');
      await storage.put(key, files[i].bytes, {httpMetadata: {contentType: files[i].mimeType}});
      keys.push(key);
    }
    return keys;
  } catch (err) {
    await removeFiles(keys);
    throw new SiteError('Photo upload failed. No DPR data was saved: ' + (err instanceof Error ? err.message : String(err)));
  }
}

export async function removeFiles(keys: string[]) {
  if (!keys.length) return;
  try { await documentStorage().delete(keys); } catch { /* best effort */ }
}

export async function listFiles(prefix: string): Promise<Array<{key: string; size: number}>> {
  const storage: any = documentStorage();
  const out: Array<{key: string; size: number}> = [];
  if (typeof storage.list !== 'function') return out;
  let cursor: string | undefined;
  do {
    const page = await storage.list({prefix: prefix.endsWith('/') ? prefix : prefix + '/', cursor});
    for (const o of page.objects || []) out.push({key: o.key, size: o.size});
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}
