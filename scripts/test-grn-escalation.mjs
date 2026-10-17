// Deliveries with no GRN after their expected date: day 1 → site engineer + PM, day 2+ → GM too.
//   node --import ./scripts/ts-resolve.mjs scripts/test-grn-escalation.mjs
import assert from 'node:assert/strict';
import {expectedDeliveries, overdueGrns} from '../lib/grn-overdue.ts';

const today = '2026-10-17';
const records = [
  {id: 'r1', kind: 'plan', due: '2026-10-15'},
  {id: 'p1', kind: 'purchase', parent: 'r1', project: '902', item: 'Cement', qty: 100, unit: 'BAG', po: 'PO-1', vendor: 'KT', status: 'Ordered'},
  {id: 'p2', kind: 'purchase', project: '902', item: 'MSand', qty: 500, unit: 'CFT', po: 'PO-2', vendor: 'PC', status: 'Ordered', expectedDelivery: '2026-10-16'},
  {id: 'p3', kind: 'purchase', project: '901', item: 'Blocks', qty: 10, unit: 'NOS', po: 'PO-3', vendor: 'KT', status: 'Ordered', expectedDelivery: '2026-10-17'},
  {id: 'p4', kind: 'purchase', project: '901', item: 'Steel', qty: 10, unit: 'KG', po: 'PO-4', vendor: 'SS', status: 'Ordered', expectedDelivery: '2026-10-10', receipts: [{grnNo: 'G', accepted: 10}]},
  {id: 'p5', kind: 'purchase', project: '901', item: 'Wire', qty: 10, unit: 'KG', po: 'PO-5', vendor: 'SS', status: 'Cancelled', expectedDelivery: '2026-10-10'},
];
const all = expectedDeliveries(records, today);
assert.deepEqual(all.map((x) => x.id), ['p1', 'p2', 'p3']);
assert.equal(all.find((x) => x.id === 'p1').daysLate, 2); assert.equal(all.find((x) => x.id === 'p1').level, 'GM');
assert.equal(all.find((x) => x.id === 'p2').level, 'PM'); assert.equal(all.find((x) => x.id === 'p3').level, '');
assert.deepEqual(overdueGrns(records, today).map((x) => x.id), ['p1', 'p2']);
console.log('PASS overdue GRNs: expected date from the PO or the request; 1 day late → PM, 2+ → GM; received, cancelled and on-time lines are not escalated');
