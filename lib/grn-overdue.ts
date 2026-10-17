// Deliveries still waiting for a GRN after their expected date. Used by the site engineer's
// "Expected deliveries" list, the PM / GM warning and the daily escalation email:
//   1 day late  → the project's site engineer and PM
//   2+ days late → also the GM (one day after the PM)
import {acceptedQty} from './grn';

export type ExpectedDelivery = {
  id: string; version: number; po: string; project: string; item: string; vendor: string; unit: string;
  ordered: number; accepted: number; pending: number; expected: string; daysLate: number; level: '' | 'PM' | 'GM';
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);

export function expectedDeliveries(records: any[], today: string): ExpectedDelivery[] {
  const byId = new Map(records.map((r: any) => [r.id, r]));
  return records
    .filter((p: any) => p.kind === 'purchase' && p.status !== 'Cancelled' && !p.shortClose)
    .map((p: any) => {
      const ordered = Number(p.qty || 0), accepted = acceptedQty(p), pending = Math.max(0, Math.round((ordered - accepted) * 1000) / 1000);
      const expected = String(p.expectedDelivery || byId.get(p.parent)?.due || p.delivery || '').slice(0, 10);
      const daysLate = expected ? Math.max(0, dayDiff(today, expected)) : 0;
      return {
        id: p.id, version: p.version, po: String(p.po || ''), project: String(p.project), item: String(p.item || ''), vendor: String(p.vendor || ''), unit: String(p.unit || ''),
        ordered, accepted, pending, expected, daysLate, level: (daysLate >= 2 ? 'GM' : daysLate >= 1 ? 'PM' : '') as ExpectedDelivery['level'],
      };
    })
    .filter((x) => x.pending > 1e-9)
    .sort((a, b) => (a.expected || '9999').localeCompare(b.expected || '9999'));
}
export const overdueGrns = (records: any[], today: string) => expectedDeliveries(records, today).filter((x) => x.daysLate >= 1);
