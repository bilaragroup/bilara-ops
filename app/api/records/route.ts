import {sameOrigin} from '@/lib/access';
import { MILESTONE_NUMBERS, activityOf, milestoneLabel } from '@/lib/activities';
import { protect } from '@/lib/access';
import { paymentBlock } from '@/lib/grn';
import {
  Actor,
  confidential,
  visible,
  inProject,
  has,
} from '@/lib/permissions';
import {
  defaultSettings,
  findProjectRate,
  rateCardLabel,
  purchaseTarget,
} from '@/lib/settings';
import { validateWorkflow } from '@/lib/workflow';
import { indiaToday, addDays, thursday } from '@/lib/weekly';
import { database, decode } from '@/lib/database';
import {
  cents,
  dateValid,
  purchaseCost,
  validProject,
} from '@/lib/calculations';
const fields: Record<string, string[]> = {
  plan: [
    'project',
    'item',
    'milestone',
    'activity',
    'activityName',
    'activityBoqQty',
    'unit',
    'boqQty',
    'boqRate',
    'due',
    'owner',
    'entity',
    'notes',
  ],
  request: [
    'project',
    'item',
    'milestone',
    'activity',
    'activityName',
    'activityBoqQty',
    'unit',
    'qty',
    'estimateRate',
    'due',
    'owner',
    'entity',
    'reason',
    'priority',
    'status',
    'reviewNote',
  ],
  purchase: [
    'project',
    'item',
    'unit',
    'qty',
    'rate',
    'discount',
    'freight',
    'other',
    'nonRecoverableTax',
    'recoverableTax',
    'vendor',
    'po',
    'bill',
    'grn',
    'delivery',
    'status',
    'notes',
  ],
  payment: [
    'project',
    'item',
    'vendor',
    'entity',
    'amount',
    'due',
    'category',
    'bill',
    'notes',
  ],
};
const required: Record<string, string[]> = {
  plan: [
    'project',
    'item',
    'milestone',
    'activity',
    'activityName',
    'unit',
    'due',
    'owner',
  ],
  request: [
    'project',
    'item',
    'milestone',
    'activity',
    'activityName',
    'unit',
    'due',
    'owner',
  ],
  purchase: ['unit'],
  payment: ['project', 'item', 'vendor', 'due', 'category'],
};
const nums: Record<string, string[]> = {
  plan: ['activityBoqQty'],
  request: ['activityBoqQty', 'qty', 'estimateRate'],
  purchase: [
    'qty',
    'rate',
    'discount',
    'freight',
    'other',
    'nonRecoverableTax',
    'recoverableTax',
  ],
  payment: ['amount'],
};
for (const kind of ['plan', 'request', 'purchase', 'payment'])
  fields[kind].push('window');
for (const kind of ['plan', 'request'])
  fields[kind].push(
    'itemCategory',
    'stage',
    'boqOwner',
    'boqOriginalRate',
    'targetDiscountPercent',
    'rateSource',
    'rateCard',
    'trade',
    'vendor',
    'vendorPhone',
    'quoteRate',
    'quoteReference',
    'entityConfirmed',
    'auditOwner',
    'reviewNote',
    'submittedAt',
    'stageDates',
    'demandQty',
  );
fields.payment.push('paymentMode');
fields.purchase.push(
  'entity',
  'buyerName',
  'buyerAddress',
  'buyerGstin',
  'vendorAddress',
  'vendorGstin',
  'vendorContact',
  'shipTo',
  'orderTerms',
  'poDate',
  'actualPurchaseDate',
  'exceptionReason',
  'paymentTerms',
  'creditDays',
  'expectedPaymentDate',
);
const fail = (message: string, status = 400) =>
  Response.json({ error: message }, { status });
async function handleGET(req: Request, a: Actor) {
  try {
    const db = database();
    const rs = await db
      .prepare('SELECT * FROM records ORDER BY updated DESC')
      .all();
    const hs = await db
      .prepare('SELECT * FROM history ORDER BY at DESC LIMIT 150')
      .all();
    return Response.json(
      {
        records: rs.results.map(decode),
        history: hs.results,
        referenceRates: confidential(a)
          ? (await db.prepare('SELECT * FROM reference_rates').all()).results
          : undefined,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return fail('Saved records are unavailable. Please retry.', 503);
  }
}
async function handlePOST(req: Request, a: Actor) {
  try {
    if (!sameOrigin(req))
      return fail('Origin not allowed', 403);
    const body = await req.text();
    if (body.length > 40000) return fail('Record is too large');
    const b = JSON.parse(body);
    const db = database();
    const now = new Date().toISOString();
    const previous = b.id
      ? await db
          .prepare('SELECT * FROM records WHERE id=?')
          .bind(b.id)
          .first<any>()
      : null;
    const old = previous ? decode(previous) : null;
    if (b.id && !old) return fail('Record not found', 404);
    if (old && old.version !== b.version)
      return fail('This record changed. Refresh and try again.', 409);
    if (old?.status === 'Cancelled')
      return fail(
        'Cancelled records are preserved. Create a replacement order or schedule.',
      );
    if (b.action === 'settle') {
      if (!['Cash', 'UPI', 'Account Transfer'].includes(b.paymentMode))
        return fail('Select Cash, UPI or Account Transfer.');
      if (old?.kind !== 'payment') return fail('Choose a payment schedule');
      if (
        !String(b.accountsBy || '').trim() ||
        String(b.accountsBy).length > 200
      )
        return fail('Enter the accounts team member name');
      const amount = Number(b.amount);
      if (
        !Number.isFinite(amount) ||
        cents(amount) <= 0 ||
        !dateValid(b.date) ||
        !String(b.reference || '').trim()
      )
        return fail(
          'Enter a positive payment, valid date and receipt/reference',
        );
      if (b.date > indiaToday())
        return fail('Actual payment date cannot be in the future');
      const value = cents(amount);
      if (value > old.total - old.paid)
        return fail('Payment exceeds the outstanding balance');
      {
        const all = (await db.prepare('SELECT * FROM records').all()).results.map(decode);
        const blocked = paymentBlock(old, all, value);
        if (blocked) return fail(blocked);
      }
      const results = await db.batch([
        db
          .prepare(
            'INSERT INTO history (id,record_id,action,data,at) SELECT ?,id,?,?,? FROM records WHERE id=? AND version=? AND paid+?<=total',
          )
          .bind(
            crypto.randomUUID(),
            'Payment recorded',
            JSON.stringify({
              amount: value,
              date: b.date,
              reference: String(b.reference).slice(0, 2000),
              accountsBy: String(b.accountsBy).trim(),
              paymentMode: b.paymentMode,
            }),
            now,
            old.id,
            old.version,
            value,
          ),
        db
          .prepare(
            'UPDATE records SET paid=paid+?,version=version+1,updated=? WHERE id=? AND version=? AND paid+?<=total',
          )
          .bind(value, now, old.id, old.version, value),
      ]);
      if (!results[1].meta.changes)
        return fail('This balance changed. Refresh and retry.', 409);
      return Response.json({ ok: true });
    }
    const kind = old?.kind || b.kind;
    if (!fields[kind]) return fail('Unknown record type');
    const data: any = {
      createdBy: old?.createdBy || a.email,
      assignedTo: old?.assignedTo || '',
      requestedQty:
        old?.requestedQty ||
        old?.boqQty ||
        old?.qty ||
        b.boqQty ||
        b.qty ||
        b.demandQty,
    };
    for (const k of fields[kind]) data[k] = b[k] ?? old?.[k] ?? '';
    // Delivery is recorded only through Receive goods (GRN) or Purchase orders actions.
    if (kind === 'purchase') {
      if (old) {
        data.status = old.status;
        data.grn = old.grn || '';
        data.delivery = old.delivery || '';
        if (Number(old.acceptedQty || 0) > 0 && Number(data.qty) < Number(old.acceptedQty))
          return fail('Quantity cannot go below what was already accepted at site.');
        if (old.shortClose && Number(data.qty) !== Number(old.qty))
          return fail('This line was closed short. Raise a new PO for more.');
      } else {
        data.status = 'Ordered';
        data.grn = '';
        data.delivery = '';
      }
    }
    if (kind === 'payment' && old?.basis === 'GRN' && cents(Number(data.amount)) !== old.total)
      return fail('This payment follows the quantity accepted at site and cannot be edited.');
    if (kind === 'purchase' && old) {
      for (const k of [
        'originalDelivery',
        'expectedDelivery',
        'deliveryUpdate',
        'orderCancellation',
      ])
        if (old[k]) data[k] = old[k];
    }
    if (old?.baselineIssuedBy) data.baselineIssuedBy = old.baselineIssuedBy;
    // Audit decisions are written by /api/audit-decision; keep them on later edits.
    for (const k of ['auditBy', 'auditSavings', 'auditReturn', 'reschedule', 'carryForwards', 'receipts', 'acceptedQty', 'receivedQty', 'rejectedQty', 'orderedTotal', 'originalQty', 'advanceApplied', 'shortClose', 'bills', 'billStatus', 'billSummary', 'billApproval', 'basis', 'grnNo', 'grnAdjustments', 'expectedPaymentDate'])
      if (old?.[k]) data[k] = old[k];
    if (
      has(a, 'GM') &&
      ['BOQ priced', 'Vendors finalized', 'Audit approved'].includes(data.stage)
    )
      data.baselineIssuedBy = a.email;
    if (old?.boqDraftBy) {
      data.boqDraftBy = old.boqDraftBy;
      data.boqDraftAt = old.boqDraftAt;
    }
    if (
      has(a, 'BOQ Team') &&
      old?.kind === 'plan' &&
      old.stage === 'Submitted'
    ) {
      data.boqDraftBy = a.name;
      data.boqDraftAt = now;
    }
    if (old?.gmApproval) data.gmApproval = old.gmApproval;
    if (old?.closure) data.closure = old.closure;
    if (old?.cancellation) data.cancellation = old.cancellation;
    if (kind === 'purchase' && old?.orderId) {
      data.orderId = old.orderId;
      data.orderLine = old.orderLine;
      if (
        [
          'buyerName',
          'buyerAddress',
          'buyerGstin',
          'vendorAddress',
          'vendorGstin',
          'vendorContact',
          'shipTo',
          'orderTerms',
          'paymentTerms',
        ].some(
          (k) =>
            String(data[k] || (k === 'entity' ? 'GROUP' : '')) !==
            String(old[k] || (k === 'entity' ? 'GROUP' : '')),
        )
      )
        return fail(
          'Shared PO details are fixed for this order. Item quantities, charges and delivery can be updated.',
        );
    }
    if (['plan', 'request'].includes(kind)) {
      data.project = String(data.project || '')
        .trim()
        .replace(/\.0+$/, '');
      data.item = String(data.item || '').trim();
      data.unit = String(data.unit || '').trim();
    }
    if (['plan', 'request', 'payment'].includes(kind)) {
      data.entity = String(data.entity || 'GROUP').toUpperCase();
      if (!['GROUP', 'BUILDERS'].includes(data.entity))
        return fail('Purchasing entity must be Group or Builders.');
      if (['plan', 'request'].includes(kind)) {
        data.entityConfirmed = old?.entityConfirmed || false;
        if (old && has(a, 'Purchase Manager', 'Purchase Team') && b.entity)
          data.entityConfirmed = true;
      }
    }
    if (
      kind === 'payment' &&
      data.paymentMode &&
      !['Cash', 'UPI', 'Account Transfer'].includes(data.paymentMode)
    )
      return fail('Invalid payment mode.');
    for (const k of required[kind])
      if (!String(data[k]).trim()) return fail(k + ' is required');
    // The approved activity BOQ quantity comes from the BOQ team. A new request may
    // arrive without it; only the BOQ team, GM or Audit may change it afterwards.
    if (['plan', 'request'].includes(kind)) {
      if (old && !confidential(a)) data.activityBoqQty = old.activityBoqQty;
      if (
        data.activityBoqQty === '' ||
        data.activityBoqQty == null ||
        Number(data.activityBoqQty) === 0
      )
        delete data.activityBoqQty;
    }
    for (const k of nums[kind]) {
      if (k === 'activityBoqQty' && data[k] === undefined) continue;
      if (data[k] === '' || data[k] === null)
        return fail(k + ' is required (use zero where applicable)');
      data[k] = Number(data[k]);
      if (!Number.isFinite(data[k]) || data[k] < 0 || data[k] > 1000000000)
        return fail(k + ' must be a valid non-negative number');
    }
    if (
      (['request', 'purchase'].includes(kind) && data.qty <= 0) ||
      (kind === 'payment' && cents(data.amount) <= 0)
    )
      return fail('Quantity / amount must be greater than zero');
    if (['plan', 'request', 'payment'].includes(kind) && !dateValid(data.due))
      return fail('Choose a valid date');
    for (const k of fields[kind])
      if (typeof data[k] === 'string' && data[k].length > 4000)
        return fail(k + ' is too long');
    let parent = old?.parent || b.parent || null;
    let total = 0;
    if (['plan', 'request'].includes(kind)) {
      const savedSettings = await db
          .prepare("SELECT data FROM settings WHERE id='main'")
          .first<any>(),
        options = {
          ...defaultSettings,
          ...(savedSettings ? JSON.parse(savedSettings.data) : {}),
        };
      for (const [field, list] of [
        ['owner', 'owners'],
        ['itemCategory', 'itemCategories'],
        ['boqOwner', 'boqPreparers'],
      ]) {
        if (
          data[field] &&
          data[field] !== 'Rate catalogue' &&
          (!old || data[field] !== old[field]) &&
          !options[list].includes(data[field])
        )
          return fail('Choose ' + field + ' from Settings.');
      }
      const catalogue = !old
        ? findProjectRate(options, data.project, data.item, data.unit)
        : null;
      if (catalogue) {
        data.boqOriginalRate = catalogue.originalRate;
        data.targetDiscountPercent = catalogue.discountPercent;
        data.rateSource = 'Project rate catalogue';
        data.rateCard = rateCardLabel(catalogue);
        data.boqOwner = 'Rate catalogue';
        if (kind === 'plan') data.boqRate = purchaseTarget(catalogue);
        else data.estimateRate = purchaseTarget(catalogue);
      } else if (data.boqOriginalRate !== '' && data.boqOriginalRate != null) {
        data.boqOriginalRate = Number(data.boqOriginalRate);
        data.targetDiscountPercent =
          data.targetDiscountPercent === '' ||
          data.targetDiscountPercent == null
            ? 5
            : Number(data.targetDiscountPercent);
        if (
          !Number.isFinite(data.boqOriginalRate) ||
          data.boqOriginalRate <= 0 ||
          !Number.isFinite(data.targetDiscountPercent) ||
          data.targetDiscountPercent < 0 ||
          data.targetDiscountPercent > 50
        )
          return fail(
            'Enter a positive original BOQ rate and target reduction from 0% to 50%.',
          );
        const target =
          Math.round(
            data.boqOriginalRate * (1 - data.targetDiscountPercent / 100) * 100,
          ) / 100;
        if (kind === 'plan') data.boqRate = target;
        else data.estimateRate = target;
        data.rateSource = data.rateSource || 'BOQ exception';
      }
      // Trade of the work: Structural (default), Electrical or Plumbing.
      data.trade = data.trade ? String(data.trade).trim() : old?.trade || 'Structural';
      if (!['Structural', 'Electrical', 'Plumbing'].includes(data.trade))
        return fail('Trade must be Structural, Electrical or Plumbing.');
      data.milestone = String(data.milestone).trim();
      data.activity = String(data.activity).trim();
      data.activityName = String(data.activityName).trim();
      // Old records keep their saved milestone and activity; new or changed ones must come
      // from the company list (five milestones, each activity in one milestone).
      const unchanged =
        old &&
        String(old.milestone) === data.milestone &&
        String(old.activity) === data.activity;
      if (!unchanged) {
        if (
          !options.milestones.includes(data.milestone) ||
          !MILESTONE_NUMBERS.includes(data.milestone)
        )
          return fail('Choose an active milestone from Settings.');
        if (!/^[1-9][0-9]{0,2}$/.test(data.activity))
          return fail(
            'Activity must be a whole number, such as 4. Request sequence is assigned automatically.',
          );
        const listed = activityOf(data.activity);
        if (!listed)
          return fail('Activity ' + data.activity + ' is not in the company activity list.');
        if (String(listed.milestone) !== data.milestone)
          return fail(
            'Activity ' + listed.number + ' (' + listed.name + ') belongs to ' + milestoneLabel(listed.milestone) + '.',
          );
        if (!data.activityName) data.activityName = listed.name;
      }
      if (data.activityBoqQty !== undefined && data.activityBoqQty <= 0)
        return fail('Activity BOQ quantity must be greater than zero.');
      const all = (
          await db
            .prepare("SELECT * FROM records WHERE kind IN ('plan','request')")
            .all()
        ).results.map(decode),
        sameActivity = all.filter(
          (r) =>
            r.id !== old?.id &&
            r.project === String(data.project).trim() &&
            String(r.milestone) === data.milestone &&
            String(r.activity) === data.activity,
        ),
        sameItem = sameActivity.filter(
          (r) =>
            String(r.item).trim().toLowerCase() ===
              String(data.item).trim().toLowerCase() &&
            String(r.unit).trim().toLowerCase() ===
              String(data.unit).trim().toLowerCase(),
        );
      const established = sameItem
        .map((r) => Number(r.activityBoqQty))
        .find((n) => Number.isFinite(n) && n > 0);
      if (
        established &&
        data.activityBoqQty !== undefined &&
        Math.abs(established - data.activityBoqQty) > 0.000000001
      )
        return fail(
          'Activity BOQ quantity must match the existing baseline of ' +
            established +
            ' ' +
            data.unit +
            '.',
        );
      if (established || data.activityBoqQty !== undefined)
        data.activityBoqQty = established || data.activityBoqQty;
      data.requestBatchId =
        old?.requestBatchId || String(b.requestBatchId || crypto.randomUUID());
      const batchRow = sameActivity.find(
        (r) => r.requestBatchId === data.requestBatchId,
      );
      data.activityRequestNo =
        old?.activityRequestNo ||
        batchRow?.activityRequestNo ||
        Math.max(
          0,
          ...sameActivity.map((r) => Number(r.activityRequestNo) || 0),
        ) + 1;
      data.activityRequestCode = data.activity + '.' + data.activityRequestNo;
      // Rejected lines use nothing; a cancelled line keeps only what was delivered before cancelling.
      const previousRequested = sameItem.reduce(
          (n, r) =>
            n +
            (r.stage === 'Rejected'
              ? 0
              : r.stage === 'Cancelled'
                ? Number(r.requestCancellation?.keptQty || 0)
                : Number(r.requestedQty || r.boqQty || r.qty || 0)),
          0,
        ),
        currentRequested = Number(
          data.requestedQty || data.boqQty || data.qty || 0,
        ),
        cumulative = previousRequested + currentRequested,
        excess = Math.max(0, cumulative - (data.activityBoqQty || 0));
      // No approved quantity yet: the BOQ team enters it on review, and the check runs then.
      if (!(data.activityBoqQty > 0)) delete data.quantityControl;
      else data.quantityControl = {
        baseline: data.activityBoqQty,
        previousRequested,
        currentRequested,
        cumulative,
        remaining: Math.max(0, data.activityBoqQty - cumulative),
        excess,
        variancePercent: data.activityBoqQty
          ? (excess / data.activityBoqQty) * 100
          : 0,
      };
      if (data.activityBoqQty > 0 && excess > 0) {
        const unchanged =
          old?.quantityControl &&
          Number(old.quantityControl.cumulative) === cumulative &&
          Number(old.quantityControl.baseline) === data.activityBoqQty;
        data.gmApproval =
          unchanged &&
          old?.gmApproval?.reasons?.includes('Activity quantity variation')
            ? old.gmApproval
            : {
                state: 'Pending',
                reasons: [
                  ...new Set([
                    ...(old?.gmApproval?.state === 'Pending'
                      ? old.gmApproval.reasons || []
                      : []),
                    'Activity quantity variation',
                  ]),
                ],
                baseline: data.activityBoqQty,
                cumulative,
                excess,
              };
      }
    }
    if (['Audit approved', 'Rejected'].includes(data.stage))
      data.auditOwner = a.name;
    if (kind !== 'purchase') {
      const issue = validateWorkflow(kind, data, old);
      if (issue) return fail(issue);
    }
    if (
      !old &&
      ['plan', 'request'].includes(kind) &&
      data.rateSource === 'Project rate catalogue' &&
      data.activityBoqQty > 0 &&
      data.gmApproval?.state !== 'Pending'
    ) {
      data.stage = 'BOQ priced';
      data.baselineIssuedBy = 'rate-catalogue';
      data.stageDates = { ...(data.stageDates || {}), 'BOQ priced': now };
    }
    if (kind === 'request') total = cents(data.qty * data.estimateRate);
    if (kind === 'purchase') {
      const p = parent
        ? await db
            .prepare('SELECT * FROM records WHERE id=?')
            .bind(parent)
            .first<any>()
        : null;
      const plan = p ? decode(p) : null;
      if (!plan || !['plan', 'request'].includes(plan.kind))
        return fail('Link a purchase plan or approved request');
      const issue = validateWorkflow(kind, data, old, plan);
      if (issue) return fail(issue);
      data.po =
        old?.po ||
        data.po ||
        'PO-' +
          data.window.replaceAll('-', '') +
          '-' +
          crypto.randomUUID().slice(0, 8).toUpperCase();
      if (plan.kind === 'request' && plan.status !== 'Approved')
        return fail('Approve the ad hoc request before purchasing');
      if (data.unit !== plan.unit)
        return fail('Purchase unit must match the plan unit');
      if (data.discount > data.qty * data.rate)
        return fail('Discount exceeds base amount');
      if (
        ![
          'Ordered',
          'Part delivered',
          'Delivered',
          'In transit',
          'Delayed',
          'Not delivered',
        ].includes(data.status)
      )
        return fail('Choose a purchase status');
      if (
        data.status === 'Delivered' &&
        (!dateValid(data.delivery) || !String(data.grn).trim())
      )
        return fail('Delivered purchases need a delivery date and GRN');
      if (data.delivery && !dateValid(data.delivery))
        return fail('Delivery date is invalid');
      data.entity = plan.entity || 'GROUP';
      data.project = plan.project;
      data.item = plan.item;
      data.expectedPaymentDate = addDays(
        data.expectedDelivery || plan.due,
        Number(data.creditDays),
      );
      total = purchaseCost(data).cash;
      const dup = await db
        .prepare(
          "SELECT id FROM records WHERE kind='purchase' AND parent=? AND json_extract(data,'$.po')=? AND id<>?",
        )
        .bind(parent, data.po, old?.id || '')
        .first();
      if (dup)
        return fail(
          'This PO already has a purchase line for this requirement. Edit the existing line.',
        );
    }
    if (kind === 'payment') {
      if (
        old?.paid > 0 &&
        (['project', 'vendor', 'entity', 'item'].some(
          (k) =>
            String(data[k] || (k === 'entity' ? 'GROUP' : '')) !==
            String(old[k] || (k === 'entity' ? 'GROUP' : '')),
        ) ||
          parent !== old.parent)
      )
        return fail(
          'Payment identity cannot change after money has been recorded. Keep the original vendor, entity, project and purchase link.',
        );
      total = cents(data.amount);
      if (old && total < old.paid)
        return fail(
          'Schedule amount cannot be below payments already recorded',
        );
      if (parent) {
        const p = await db
          .prepare('SELECT * FROM records WHERE id=?')
          .bind(parent)
          .first<any>();
        if (!p || p.kind !== 'purchase') return fail('Link a valid purchase');
        const buy = decode(p);
        if (buy.status === 'Cancelled')
          return fail('Cannot schedule a cancelled PO item.');
        if (data.entity !== (buy.entity || 'GROUP'))
          return fail('Purchasing entity must match the linked purchase.');
        if (data.project !== buy.project || data.vendor !== buy.vendor)
          return fail('Project and vendor must match the linked purchase');
      }
    }
    if (!validProject(data.project))
      return fail('Project number must be a whole number from 100 to 999.');
    data.project = String(data.project).trim();
    if (!old && ['plan', 'request'].includes(kind)) {
      const configured = await db
        .prepare('SELECT COUNT(*) AS count FROM project_configs')
        .first<any>();
      if (Number(configured?.count) > 0) {
        const activeProject = await db
          .prepare(
            'SELECT 1 AS ok FROM project_configs WHERE project=? AND active=1',
          )
          .bind(data.project)
          .first();
        if (!activeProject)
          return fail('Choose an active project from Project configuration.');
      }
    }
    const id = old?.id || crypto.randomUUID();
    const sourceId = old?.sourceId || b.sourceId || null;
    const json = JSON.stringify(data);
    const action = old ? 'Updated ' + kind : 'Created ' + kind;
    let guard = '';
    let values: any[] = [];
    if (kind === 'payment' && parent) {
      guard =
        " AND ? + COALESCE((SELECT SUM(total) FROM records WHERE kind='payment' AND parent=? AND id<>?),0) <= COALESCE((SELECT total FROM records WHERE id=? AND kind='purchase'),-1)";
      values = [total, parent, id, parent];
    }
    if (kind === 'purchase') {
      guard =
        " AND ? >= COALESCE((SELECT SUM(total) FROM records WHERE kind='payment' AND parent=?),0) AND ? + COALESCE((SELECT SUM(CAST(json_extract(data,'$.qty') AS REAL)) FROM records WHERE kind='purchase' AND parent=? AND id<>? AND COALESCE(json_extract(data,'$.status'),'')<>'Cancelled'),0) <= COALESCE((SELECT CAST(COALESCE(NULLIF(json_extract(data,'$.boqQty'),''),json_extract(data,'$.qty')) AS REAL)-COALESCE(CAST(json_extract(data,'$.cancellation.qty') AS REAL),0) FROM records WHERE id=?),0)+0.000000001";
      values = [total, id, data.qty, parent, id, parent];
    }
    const rootId =
      kind === 'plan' || kind === 'request'
        ? id
        : kind === 'purchase'
          ? parent
          : parent
            ? (
                await db
                  .prepare('SELECT parent FROM records WHERE id=?')
                  .bind(parent)
                  .first<any>()
              )?.parent
            : null;
    if (rootId) {
      const root = await db
        .prepare('SELECT data FROM records WHERE id=?')
        .bind(rootId)
        .first<any>();
      if (root && JSON.parse(root.data).closure?.state === 'Closed')
        return fail(
          'This request is closed. Reopen it with a reason before changing linked records.',
        );
      guard +=
        " AND NOT EXISTS (SELECT 1 FROM records WHERE id=? AND json_extract(data,'$.closure.state')='Closed')";
      values.push(rootId);
    }
    if (!Number.isSafeInteger(total) || total < 0)
      return fail('Amount is outside the supported precise currency range.');
    if (b.dryRun === true) {
      const permitted = await db
        .prepare('SELECT 1 AS ok WHERE 1=1' + guard)
        .bind(...values)
        .first();
      if (!permitted)
        return fail(
          'Quantity, payment balance or closure checks failed. Review the linked purchase.',
        );
      return Response.json({ ok: true });
    }
    if (old) {
      const result = await db.batch([
        db
          .prepare(
            'INSERT INTO history (id,record_id,action,data,at) SELECT ?,id,?,?,? FROM records WHERE id=? AND version=?' +
              guard,
          )
          .bind(
            crypto.randomUUID(),
            action,
            JSON.stringify({ before: old, after: data }),
            now,
            id,
            old.version,
            ...values,
          ),
        db
          .prepare(
            'UPDATE records SET data=?,total=?,version=version+1,updated=? WHERE id=? AND version=?' +
              guard,
          )
          .bind(json, total, now, id, old.version, ...values),
      ]);
      if (!result[1].meta.changes)
        return fail(
          'Record changed or payment schedules exceed the purchase commitment. Refresh and check the amounts.',
          400,
        );
    } else {
      const result = await db.batch([
        db
          .prepare(
            'INSERT INTO records (id,kind,parent,source_id,data,version,total,paid,updated) SELECT ?,?,?,?,?,1,?,0,? WHERE 1=1' +
              guard,
          )
          .bind(id, kind, parent, sourceId, json, total, now, ...values),
        db
          .prepare(
            'INSERT INTO history (id,record_id,action,data,at) SELECT ?,id,?,?,? FROM records WHERE id=?',
          )
          .bind(crypto.randomUUID(), action, json, now, id),
      ]);
      if (!result[0].meta.changes)
        return fail(
          'Payment schedules exceed the linked purchase commitment. Adjust the amount.',
        );
    }
    if (
      ['plan', 'request'].includes(kind) &&
      Number(data.boqOriginalRate) > 0 &&
      !b.dryRun &&
      (!old || Number(old.boqOriginalRate) !== Number(data.boqOriginalRate))
    ) {
      await db
        .prepare(
          'INSERT INTO reference_rates(record_id,rate,version,updated_by,updated) VALUES(?,?,?,?,?) ON CONFLICT(record_id) DO UPDATE SET rate=excluded.rate,version=reference_rates.version+1,updated_by=excluded.updated_by,updated=excluded.updated',
        )
        .bind(
          id,
          cents(data.boqOriginalRate),
          1,
          data.rateSource === 'Project rate catalogue'
            ? 'rate-catalogue'
            : a.email,
          now,
        )
        .run();
    }
    if (kind === 'purchase' && !old && !b.dryRun) {
      const paymentId = crypto.randomUUID(),
        due = data.expectedPaymentDate,
        payment = {
          createdBy: a.email,
          project: data.project,
          item: data.item,
          vendor: data.vendor,
          entity: data.entity,
          amount: total / 100,
          due,
          window: thursday(due),
          category: 'Material',
          bill: '',
          notes: `Auto-created from ${data.po} · ${data.creditDays} credit day(s) from delivery`,
          paymentMode: '',
        };
      await db.batch([
        db
          .prepare(
            "INSERT INTO records(id,kind,parent,data,version,total,paid,updated) VALUES(?,'payment',?,?,1,?,0,?)",
          )
          .bind(paymentId, id, JSON.stringify(payment), total, now),
        db
          .prepare(
            "INSERT INTO history(id,record_id,action,data,at) VALUES(?,?,'Payment forecast created from PO',?,?)",
          )
          .bind(crypto.randomUUID(), paymentId, JSON.stringify(payment), now),
      ]);
    }
    return Response.json({ ok: true, id });
  } catch (e) {
    if (String(e).includes('Schedule exceeds'))
      return fail(
        'Total schedules exceed the linked purchase commitment. Adjust the amounts.',
      );
    if (String(e).includes('Purchase cannot'))
      return fail(
        'Purchase cost cannot be reduced below its payment schedules.',
      );
    if (String(e).includes('UNIQUE'))
      return fail(
        'This source row or PO was already entered. Open its existing record.',
        409,
      );
    return fail('Unable to save. Check your inputs and retry.', 400);
  }
}

export async function GET(req: Request) {
  return protect(req, 'read', handleGET);
}

export async function POST(req: Request) {
  return protect(req, 'records', handlePOST);
}
