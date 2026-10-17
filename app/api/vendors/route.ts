// Vendor / brand / price list (project configuration). Everyone who raises or handles requests can
// read vendor and brand names; prices only reach purchasing, GM, Audit and Super Admin. Purchase,
// GM and Super Admin change it. Stored as settings row 'vendors', version-checked.
import {protect, sameOrigin} from '@/lib/access';
import {has, type Actor} from '@/lib/permissions';
import {database} from '@/lib/database';
import {validateVendors} from '@/lib/vendors';

const fail = (error: string, status = 400) => Response.json({error}, {status});
const canSeePrice = (a: Actor) => has(a, 'Purchase Manager', 'Purchase Team', 'GM', 'Audit');
const canEdit = (a: Actor) => has(a, 'Purchase Manager', 'Purchase Team', 'GM');

async function load() {
  const row = await database().prepare("SELECT * FROM settings WHERE id='vendors'").first<any>();
  return {list: row ? JSON.parse(row.data).list || [] : [], version: Number(row?.version || 0)};
}
async function handleGET(_req: Request, a: Actor) {
  try {
    const {list, version} = await load();
    const values = canSeePrice(a) ? list : list.map(({price, ...rest}: any) => rest);
    return Response.json({values, version, canEdit: canEdit(a)}, {headers: {'Cache-Control': 'no-store'}});
  } catch {
    return fail('The vendor list is unavailable.', 503);
  }
}
async function handlePOST(req: Request, a: Actor) {
  try {
    if (!sameOrigin(req)) return fail('Origin not allowed', 403);
    if (!canEdit(a)) return fail('Only Purchase or the GM can change the vendor list.', 403);
    const text = await req.text();
    if (text.length > 1_500_000) return fail('The vendor list is too large.');
    const b = JSON.parse(text), now = new Date().toISOString();
    const {list: old, version} = await load();
    if (b.version !== version) return fail('The vendor list changed meanwhile. Reload and try again.', 409);
    const before = new Map(old.map((x: any) => [x.id, JSON.stringify({...x, updatedAt: '', updatedBy: ''})]));
    const list = validateVendors(b.values).map((x) =>
      before.get(x.id) === JSON.stringify({...x, updatedAt: '', updatedBy: ''}) ? x : {...x, updatedBy: a.name || a.email, updatedAt: now});
    const res = await database().prepare("INSERT INTO settings(id,data,version,updated) VALUES('vendors',?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version,updated=excluded.updated WHERE settings.version=?")
      .bind(JSON.stringify({list}), version + 1, now, version).run();
    if (!res.meta.changes) return fail('The vendor list changed meanwhile. Reload and try again.', 409);
    return Response.json({values: list, version: version + 1});
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not save the vendor list.');
  }
}
export async function GET(req: Request) { return protect(req, 'read', handleGET); }
export async function POST(req: Request) { return protect(req, 'read', handlePOST); }
