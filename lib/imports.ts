import { defaultSettings, Settings } from './settings';
import { requestPolicy, requestDateIssue } from './request-policy';
import ExcelJS from 'exceljs';
import { validProject } from './calculations';
import { validWindow, addDays } from './weekly';
import { RATE_CARD_ITEMS } from './rate-card';
export const requestColumns = [
  'Request ID',
  'Type',
  'Project',
  'Week starts',
  'Item',
  'Unit',
  'Quantity',
  'Required date',
  'Owner',
  'Remarks',
  'Required quantity',
  'BOQ rate',
  'BOQ preparer',
  'Vendor',
  'Vendor rate',
  'Quote reference',
  'Ad hoc reason',
];
const modernUpdateColumns = requestColumns
  .filter((h) => h !== 'Required quantity')
  .map((h) => (h === 'Quantity' ? 'Required quantity' : h))
  .flatMap((h) =>
    h === 'Project'
      ? [h, 'Milestone', 'Activity', 'Activity Name', 'Activity BOQ Quantity']
      : h === 'Item'
        ? [h, 'Item Category']
        : [h],
  );
export const newRequestColumns = modernUpdateColumns.filter(
  (h) =>
    ![
      'BOQ rate',
      'BOQ preparer',
      'Vendor',
      'Vendor rate',
      'Quote reference',
    ].includes(h),
);
export const paymentColumns = [
  'Payment ID',
  'Project',
  'Week starts',
  'Item',
  'Vendor',
  'Amount',
  'Payment date',
  'PO number',
  'Category',
  'Remarks',
];
export const boqWorkflowColumns = [
  'Request ID',
  'Project',
  'Milestone',
  'Activity Request',
  'Activity Name',
  'Item',
  'Unit',
  'Activity BOQ Quantity',
  'BOQ Quantity',
  'Original BOQ Rate',
  'Target Reduction %',
  'Purchase Target Rate',
  'BOQ Preparer',
  'Notes',
];
export const vendorWorkflowColumns = [
  'Request ID',
  'Project',
  'Milestone',
  'Activity Request',
  'Activity Name',
  'Item',
  'Unit',
  'BOQ Quantity',
  'Purchase Target Rate',
  'Purchasing Entity',
  'Selected Vendor',
  'Vendor Phone',
  'Vendor Unit Rate',
  'Quote Reference',
  'Notes',
];
export async function template(
  kind: string,
  project: string,
  window: string,
  records: any[] = [],
  filled = false,
  settings: Settings = defaultSettings,
) {
  if (!filled && kind === 'request' && window < requestPolicy().normal)
    window = requestPolicy().normal;
  const workflow = ['boq', 'vendor'].includes(kind),
    book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet(
      kind === 'payment'
        ? 'Payments'
        : kind === 'boq'
          ? 'BOQ Review'
          : kind === 'vendor'
            ? 'Vendor Sourcing'
            : 'Requests',
    );
  const headers = [
    ...(kind === 'payment'
      ? paymentColumns
      : kind === 'boq'
        ? boqWorkflowColumns
        : kind === 'vendor'
          ? vendorWorkflowColumns
          : filled
            ? modernUpdateColumns
            : newRequestColumns),
  ];
  if (!filled && !workflow) headers[0] = 'Sl. No.';
  sheet.addRow(headers);
  const chosen = records.filter(
    (r) =>
      (kind === 'payment'
        ? r.kind === 'payment'
        : kind === 'boq'
          ? r.kind === 'plan' && r.stage === 'Submitted'
          : kind === 'vendor'
            ? ['plan', 'request'].includes(r.kind) && r.stage === 'BOQ priced'
            : r.kind === (kind === 'adhoc' ? 'request' : 'plan')) &&
      r.window === window &&
      (project === 'all' || r.project === project),
  );
  const requestRow = (r: any) => {
    const values: any = {
      'Request ID': r.id,
      'Sl. No.': r.serial,
      Type: kind === 'adhoc' ? 'Ad hoc' : 'Planned',
      Project: r.project,
      Milestone: r.milestone,
      Activity: r.activity,
      'Activity Name': r.activityName,
      'Activity BOQ Quantity': r.activityBoqQty,
      'Week starts': r.window,
      Item: r.item,
      'Item Category': r.itemCategory,
      Unit: r.unit,
      'Required quantity': kind === 'adhoc' ? r.qty : r.boqQty || r.demandQty,
      'Required date': r.due,
      Owner: r.owner,
      Remarks: r.notes,
      'BOQ rate': kind === 'adhoc' ? r.estimateRate : r.boqRate,
      'BOQ preparer': r.boqOwner,
      Vendor: r.vendor,
      'Vendor rate': r.quoteRate,
      'Quote reference': r.quoteReference,
      'Ad hoc reason': r.reason,
    };
    return headers.map((h) => values[h] ?? '');
  };
  const workflowRow = (r: any) =>
    headers.map(
      (h) =>
        ({
          'Request ID': r.id,
          Project: r.project,
          Milestone: r.milestone,
          'Activity Request': r.activityRequestCode || r.activity,
          'Activity Name': r.activityName,
          Item: r.item,
          Unit: r.unit,
          'Activity BOQ Quantity': r.activityBoqQty,
          'BOQ Quantity': r.kind === 'request' ? r.qty : r.boqQty,
          'Original BOQ Rate': r.boqOriginalRate,
          'Target Reduction %':
            r.targetDiscountPercent !== '' && r.targetDiscountPercent != null
              ? r.targetDiscountPercent
              : 5,
          'Purchase Target Rate':
            r.kind === 'request' ? r.estimateRate : r.boqRate,
          'BOQ Preparer': r.boqOwner,
          'Purchasing Entity': r.entityConfirmed ? r.entity : '',
          'Selected Vendor': r.vendor,
          'Vendor Phone': r.vendorPhone,
          'Vendor Unit Rate': r.quoteRate,
          'Quote Reference': r.quoteReference,
          Notes: r.notes,
        })[h] ?? '',
    );
  if (filled || workflow)
    for (const r of chosen)
      sheet.addRow(
        kind === 'payment'
          ? [
              r.id,
              r.project,
              r.window,
              r.item,
              r.vendor,
              r.amount,
              r.due,
              records.find((p) => p.id === r.parent)?.po || '',
              r.category,
              r.notes,
            ]
          : workflow
            ? workflowRow(r)
            : requestRow(r),
      );
  if (!filled)
    sheet.addRow(
      kind === 'payment'
        ? [
            1,
            project === 'all' ? '' : project,
            window,
            '',
            '',
            '',
            window,
            '',
            'Material',
            '',
          ]
        : requestRow({
            serial: 1,
            project: project === 'all' ? '' : project,
            window,
            due: window,
          }),
    );
  if (!workflow) {
    const owners = settings.owners,
      categories = settings.itemCategories,
      preparers = settings.boqPreparers,
      milestones = settings.milestones;
    const items = [...RATE_CARD_ITEMS];
    const lists = book.addWorksheet('Lists');
    lists.addRow([
      'Owners',
      'Item Categories',
      'BOQ Preparers',
      'Milestones',
      'Standard Items',
    ]);
    for (
      let i = 0;
      i <
      Math.max(
        owners.length,
        categories.length,
        preparers.length,
        milestones.length,
        items.length,
      );
      i++
    )
      lists.addRow([
        owners[i] || '',
        categories[i] || '',
        preparers[i] || '',
        milestones[i] || '',
        items[i] || '',
      ]);
    lists.columns.forEach((c) => (c.width = 30));
    for (let row = 2; row <= 501; row++)
      for (const [header, col] of [
        ['Owner', 'A'],
        ['Item Category', 'B'],
        ['BOQ preparer', 'C'],
        ['Milestone', 'D'],
      ]) {
        const index = headers.indexOf(header);
        if (index >= 0)
          sheet.getCell(row, index + 1).dataValidation = {
            type: 'list',
            allowBlank: false,
            formulae: [`INDIRECT("'Lists'!$${col}$2:$${col}$501")`],
            showErrorMessage: true,
            errorTitle: 'Choose a listed value',
            error:
              'Choose from the dropdown. Update application Settings for new entries.',
          };
      }
    const itemColumn = headers.indexOf('Item');
    if (itemColumn >= 0)
      for (let row = 2; row <= 501; row++)
        sheet.getCell(row, itemColumn + 1).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [`INDIRECT("'Lists'!$E$2:$E$17")`],
          showInputMessage: true,
          promptTitle: 'Standard item',
          prompt: 'Choose a listed item or type another item.',
          showErrorMessage: false,
        };
  }
  if (workflow) {
    const editable =
      kind === 'boq'
        ? [
            'Activity BOQ Quantity',
            'BOQ Quantity',
            'Original BOQ Rate',
            'Target Reduction %',
            'BOQ Preparer',
            'Notes',
          ]
        : [
            'Purchasing Entity',
            'Selected Vendor',
            'Vendor Phone',
            'Vendor Unit Rate',
            'Quote Reference',
            'Notes',
          ];
    headers.forEach((h, i) => {
      const input = editable.includes(h);
      sheet.getCell(1, i + 1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: input ? 'FFF4B942' : 'FF126B70' },
      };
      for (let row = 2; row <= Math.max(501, sheet.rowCount); row++) {
        sheet.getCell(row, i + 1).protection = { locked: !input };
        if (input)
          sheet.getCell(row, i + 1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFF6D8' },
          };
      }
    });
    const lists = book.addWorksheet('Lists');
    lists.addRow(['BOQ Preparers', 'Purchasing Entities']);
    settings.boqPreparers.forEach(
      (x, i) => (lists.getCell(i + 2, 1).value = x),
    );
    ['GROUP', 'BUILDERS'].forEach(
      (x, i) => (lists.getCell(i + 2, 2).value = x),
    );
    lists.columns.forEach((c) => (c.width = 30));
    if (kind === 'boq') {
      const col = headers.indexOf('BOQ Preparer') + 1;
      for (let row = 2; row <= 501; row++)
        sheet.getCell(row, col).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [`INDIRECT("'Lists'!$A$2:$A$501")`],
          showErrorMessage: true,
        };
    } else {
      const col = headers.indexOf('Purchasing Entity') + 1;
      for (let row = 2; row <= 501; row++)
        sheet.getCell(row, col).dataValidation = {
          type: 'list',
          allowBlank: false,
          formulae: [`INDIRECT("'Lists'!$B$2:$B$3")`],
          showErrorMessage: true,
        };
    }
  }
  sheet.columns.forEach((c, i) => (c.width = i === 4 ? 32 : 20));
  // Keep technical keys in the workbook so update uploads can resolve the
  // exact record, but do not expose them in the operator-facing view.
  headers.forEach((header, i) => {
    if (/\b(?:Request|Payment) ID\b/i.test(header)) {
      sheet.getColumn(i + 1).hidden = true;
      sheet.getColumn(i + 1).width = 3;
    }
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: headers.length } };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF126B70' },
  };
  if (workflow) {
    const editable =
      kind === 'boq'
        ? [
            'Activity BOQ Quantity',
            'BOQ Quantity',
            'Original BOQ Rate',
            'Target Reduction %',
            'BOQ Preparer',
            'Notes',
          ]
        : [
            'Purchasing Entity',
            'Selected Vendor',
            'Vendor Phone',
            'Vendor Unit Rate',
            'Quote Reference',
            'Notes',
          ];
    headers.forEach((h, i) => {
      if (editable.includes(h))
        sheet.getCell(1, i + 1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD99B13' },
        };
    });
  }
  const help = book.addWorksheet('Instructions');
  help.getColumn(1).width = 110;
  const instructions =
    kind === 'boq'
      ? [
          'This workbook contains catalogue exceptions awaiting BOQ preparation.',
          'Enter the confidential original BOQ rate. Target Reduction defaults to 5%; the BOQ Team may override it for this item.',
          'The application calculates the purchase target. Keep hidden technical columns unchanged.',
          'The GM releases the completed exception before vendor sourcing.',
        ]
      : kind === 'vendor'
        ? [
            'This workbook contains priced requests ready for vendor sourcing.',
            'Confirm Group or Builders, then enter vendor, phone, quoted rate and quotation reference.',
            'The item and purchase target come from the approved request and cannot be changed. Uploading sends completed rows for Audit approval.',
          ]
        : kind === 'payment'
          ? [
              'Choose a standard item from the dropdown or type another item for a standalone expense.',
              'Project numbers must be 100–999. Payment weeks start Thursday and payment dates must be within Thursday–Wednesday.',
              'PO payment schedules are created automatically from delivery date and credit days. Use this template only for standalone or adjusted forecasts.',
              'Do not enter formulas. Review every warning before saving.',
            ]
          : [
              'Fill one item per row. Rows with the same project, milestone and activity in one upload form one multi-item purchase request.',
              'Choose a standard item from the dropdown or type another item. Custom and unmatched items go to BOQ review.',
              'Project numbers: 100–999. Week starts on Thursday; required date must be within Thursday–Wednesday.',
              'Repeat the request-level Project, Milestone, Activity, Activity Name, Week, Owner and Required Date for each item line.',
              'Activity BOQ Quantity is the item baseline for the same project, milestone, activity, item and unit. Repeated requests are accumulated against it.',
              'The application uses the confidential project BOQ rate when available. Otherwise, the BOQ Team enters it.',
              'The purchase target defaults to 5% below the BOQ rate; the BOQ Team may override that reduction for an exception.',
              'Sl. No. is optional. The application assigns technical IDs automatically; those columns remain hidden for normal review.',
    'The purchase team confirms Group or Builders and enters vendor details after pricing. Ad hoc reason is optional.',
              'Saturday 9:00 a.m. IST is the planned request cutoff, 12 calendar days before execution Thursday.',
              'Do not enter formulas. Review every warning before saving. Save the separate Excel backup outside the application.',
            ];
  instructions.forEach((x) => help.addRow([x]));
  return book.xlsx.writeBuffer();
}
export async function parseUpload(
  bytes: ArrayBuffer,
  kind: string,
  records: any[],
) {
  const workflow = ['boq', 'vendor'].includes(kind),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet(
    kind === 'payment'
      ? 'Payments'
      : kind === 'boq'
        ? 'BOQ Review'
        : kind === 'vendor'
          ? 'Vendor Sourcing'
          : 'Requests',
  );
  if (!sheet)
    throw Error('Use the downloaded template with its original sheet name.');
  if (workflow) {
    const headers = kind === 'boq' ? boqWorkflowColumns : vendorWorkflowColumns;
    headers.forEach((h, i) => {
      if (sheet.getRow(1).getCell(i + 1).text !== h)
        throw Error('Column headings do not match the template.');
    });
    const editable =
        kind === 'boq'
          ? {
              'Activity BOQ Quantity': 'activityBoqQty',
              'BOQ Quantity': 'boqQty',
              'Original BOQ Rate': 'boqOriginalRate',
              'Target Reduction %': 'targetDiscountPercent',
              'BOQ Preparer': 'boqOwner',
              Notes: 'notes',
            }
          : {
              'Purchasing Entity': 'entity',
              'Selected Vendor': 'vendor',
              'Vendor Phone': 'vendorPhone',
              'Vendor Unit Rate': 'quoteRate',
              'Quote Reference': 'quoteReference',
              Notes: 'notes',
            },
      seen = new Set<string>();
    const rows: any[] = [];
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      const vals = headers.map((_, i) => {
        const c = row.getCell(i + 1);
        return c.value == null
          ? ''
          : c.value instanceof Date
            ? c.value.toISOString().slice(0, 10)
            : c.text.trim();
      });
      if (!vals.some(Boolean)) return;
      if (rows.length >= 500) throw Error('Upload at most 500 rows at a time.');
      const errors: string[] = [];
      if (
        headers.some(
          (_, i) => row.getCell(i + 1).type === ExcelJS.ValueType.Formula,
        )
      )
        errors.push('Replace formulas with values.');
      const obj = Object.fromEntries(headers.map((h, i) => [h, vals[i]])),
        id = String(obj['Request ID'] || ''),
        old = records.find((r) => r.id === id);
      if (seen.has(id)) errors.push('Duplicate Request ID in this workbook.');
      seen.add(id);
      if (!id || !old)
        errors.push(
          'Request ID is missing or not found. Download a fresh workbook.',
        );
      if (old) {
        const requiredStage = kind === 'boq' ? 'Submitted' : 'BOQ priced';
        if (
          (kind === 'boq' && old.kind !== 'plan') ||
          (kind === 'vendor' && !['plan', 'request'].includes(old.kind)) ||
          old.stage !== requiredStage
        )
          errors.push(
            'This request is no longer at the ' +
              requiredStage +
              ' stage. Download a fresh workbook.',
          );
        for (const [heading, value] of [
          ['Project', old.project],
          ['Milestone', old.milestone],
          ['Activity Request', old.activityRequestCode || old.activity],
          ['Activity Name', old.activityName],
          ['Item', old.item],
          ['Unit', old.unit],
          ...(kind === 'vendor'
            ? [
                ['BOQ Quantity', old.kind === 'request' ? old.qty : old.boqQty],
                [
                  'Purchase Target Rate',
                  old.kind === 'request' ? old.estimateRate : old.boqRate,
                ],
              ]
            : []),
        ])
          if (String(obj[heading] || '') !== String(value || ''))
            errors.push(heading + ' cannot be changed in this workbook.');
        const data: any = { ...old };
        for (const [heading, field] of Object.entries(editable))
          if (obj[heading] !== undefined) data[field] = obj[heading];
        if (kind === 'boq')
          data.boqRate =
            Math.round(
              Number(data.boqOriginalRate) *
                (1 - Number(data.targetDiscountPercent) / 100) *
                100,
            ) / 100;
        if (kind === 'vendor') {
          data.entityConfirmed = true;
          data.stage = 'Vendors finalized';
        }
        for (const [field, label] of kind === 'boq'
          ? [
              ['activityBoqQty', 'Activity BOQ Quantity'],
              ['boqQty', 'BOQ Quantity'],
              ['boqOriginalRate', 'Original BOQ Rate'],
              ['targetDiscountPercent', 'Target Reduction %'],
              ['boqOwner', 'BOQ Preparer'],
            ]
          : [
              ['entity', 'Purchasing Entity'],
              ['vendor', 'Selected Vendor'],
              ['vendorPhone', 'Vendor Phone'],
              ['quoteRate', 'Vendor Unit Rate'],
              ['quoteReference', 'Quote Reference'],
            ])
          if (!String(data[field] ?? '').trim())
            errors.push(label + ' is required.');
        if (kind === 'vendor' && !['GROUP', 'BUILDERS'].includes(data.entity))
          errors.push('Purchasing Entity must be GROUP or BUILDERS.');
        for (const field of kind === 'boq'
          ? ['activityBoqQty', 'boqQty', 'boqOriginalRate']
          : ['quoteRate'])
          if (!Number.isFinite(Number(data[field])) || Number(data[field]) <= 0)
            errors.push(String(field) + ' must be greater than zero.');
        if (
          kind === 'boq' &&
          (!Number.isFinite(Number(data.targetDiscountPercent)) ||
            Number(data.targetDiscountPercent) < 0 ||
            Number(data.targetDiscountPercent) > 50)
        )
          errors.push('Target Reduction % must be from 0 to 50.');
        rows.push({
          row: n,
          data,
          errors,
          status: '',
          sourceId: crypto.randomUUID(),
        });
      }
    });
    return rows;
  }
  const actual = sheet.getRow(1).values as any[];
  const headers = [
    ...(kind === 'payment'
      ? paymentColumns
      : actual.includes('Item Category')
        ? actual.includes('Vendor')
          ? modernUpdateColumns
          : newRequestColumns
        : actual.includes('Vendor')
          ? requestColumns
          : requestColumns.filter(
              (h) => !['Vendor', 'Vendor rate', 'Quote reference'].includes(h),
            )),
  ];
  const firstHeading = sheet.getRow(1).getCell(1).text;
  const noSerial = firstHeading === headers[1];
  const newEntries = firstHeading === 'Sl. No.' || noSerial;
  if (noSerial) headers.shift();
  else if (newEntries) headers[0] = 'Sl. No.';
  headers.forEach((h, i) => {
    if (sheet.getRow(1).getCell(i + 1).text !== h)
      throw Error('Column headings do not match the template.');
  });
  const seen = new Set<string>();
  const rows: any[] = [];
  sheet.eachRow((row, n) => {
    if (n === 1) return;
    const vals = headers.map((_, i) => {
      const c = row.getCell(i + 1);
      return c.value == null
        ? ''
        : c.value instanceof Date
          ? c.value.toISOString().slice(0, 10)
          : c.text.trim();
    });
    if (!(newEntries && !noSerial ? vals.slice(1) : vals).some(Boolean)) return;
    if (rows.length >= 500) throw Error('Upload at most 500 rows at a time.');
    const errors: string[] = [];
    if (
      headers.some(
        (_, i) => row.getCell(i + 1).type === ExcelJS.ValueType.Formula,
      )
    )
      errors.push('Replace formulas with values.');
    const obj = Object.fromEntries(headers.map((h, i) => [h, vals[i]]));
    const id = newEntries ? '' : vals[0],
      old = id ? records.find((r) => r.id === id) : null;
    if (old?.status === 'Cancelled')
      errors.push('Cancelled schedules cannot be updated.');
    if (id && !old) errors.push('ID not found.');
    if (
      old &&
      (kind === 'payment'
        ? old.kind !== 'payment'
        : !['plan', 'request'].includes(old.kind))
    )
      errors.push('ID belongs to another record type.');
    const type =
      kind === 'payment'
        ? 'payment'
        : obj.Type === 'Ad hoc'
          ? 'request'
          : 'plan';
    if (kind !== 'payment' && !['Planned', 'Ad hoc'].includes(obj.Type))
      errors.push('Type must be Planned or Ad hoc.');
    if (old && old.kind !== type)
      errors.push('Existing request type cannot change.');
    const data: any = {
      ...(old || {}),
      kind: type,
      stage: old?.stage || 'Submitted',
      entity: old?.entity || 'GROUP',
      priority: old?.priority || 'Normal',
      status: old?.status || 'Pending',
    };
    const map: any =
      kind === 'payment'
        ? {
            Project: 'project',
            'Week starts': 'window',
            Item: 'item',
            Vendor: 'vendor',
            Amount: 'amount',
            'Payment date': 'due',
            Category: 'category',
            Remarks: 'notes',
          }
        : {
            Project: 'project',
            Milestone: 'milestone',
            Activity: 'activity',
            'Activity Name': 'activityName',
            'Activity BOQ Quantity': 'activityBoqQty',
            'Week starts': 'window',
            Item: 'item',
            'Item Category': 'itemCategory',
            Unit: 'unit',
            Quantity: type === 'plan' ? 'demandQty' : 'qty',
            'Required date': 'due',
            Owner: 'owner',
            Remarks: 'notes',
            'Required quantity': type === 'plan' ? 'boqQty' : 'qty',
            'BOQ rate': type === 'plan' ? 'boqRate' : 'estimateRate',
            'BOQ preparer': 'boqOwner',
            Vendor: 'vendor',
            'Vendor rate': 'quoteRate',
            'Quote reference': 'quoteReference',
            'Ad hoc reason': 'reason',
          };
    for (const [h, k] of Object.entries(map))
      if (obj[h] !== undefined && obj[h] !== '') data[k as string] = obj[h];
    if (type === 'plan' && data.boqQty !== undefined)
      data.demandQty = data.boqQty;
    if (
      headers.includes('Item Category') &&
      !String(data.itemCategory || '').trim()
    )
      errors.push('Item Category is required.');
    if (headers.includes('Activity Name'))
      for (const [field, label] of [
        ['milestone', 'Milestone'],
        ['activity', 'Activity'],
        ['activityName', 'Activity Name'],
        ['activityBoqQty', 'Activity BOQ Quantity'],
      ])
        if (!String(data[field] || '').trim())
          errors.push(label + ' is required.');
    if (type === 'request' && data.estimateRate == null) data.estimateRate = 0;
    if (type === 'payment') data.category = data.category || 'Material';
    if (!validProject(data.project)) errors.push('Project must be 100–999.');
    if (!validWindow(data.window)) errors.push('Week must start Thursday.');
    else if (
      !data.due ||
      data.due < data.window ||
      data.due > addDays(data.window, 6)
    )
      errors.push('Date must be within the week.');
    if (kind === 'payment' && obj['PO number']) {
      const buys = records.filter(
        (r) =>
          r.kind === 'purchase' &&
          r.po === obj['PO number'] &&
          r.project === data.project,
      );
      const linked = old?.parent ? buys.find((p) => p.id === old.parent) : null;
      const matches = buys.filter(
        (p) =>
          p.item?.toLowerCase() === data.item?.toLowerCase() &&
          p.vendor === data.vendor,
      );
      const buy =
        linked ||
        (matches.length === 1
          ? matches[0]
          : buys.length === 1
            ? buys[0]
            : null);
      if (!buy)
        errors.push(
          'PO item is ambiguous. Use the application to select its purchase line.',
        );
      else {
        data.parent = buy.id;
        data.entity = buy.entity || 'GROUP';
      }
    }
    const dateIssue = requestDateIssue(type, data, old);
    if (dateIssue) errors.push(dateIssue);
    const key =
      id ||
      [
        type,
        data.project,
        data.window,
        data.item?.toLowerCase(),
        data.unit || data.vendor,
        data.due,
      ].join('|');
    if (seen.has(key)) errors.push('Duplicate row in this file.');
    seen.add(key);
    if (
      !id &&
      records.some(
        (r) =>
          r.kind === type &&
          r.project === data.project &&
          r.window === data.window &&
          r.item?.toLowerCase() === data.item?.toLowerCase() &&
          r.due === data.due,
      )
    )
      errors.push(
        'Possible existing duplicate. Export existing rows and use its ID.',
      );
    rows.push({
      row: n,
      data,
      errors,
      status: '',
      sourceId: crypto.randomUUID(),
    });
  });
  return rows;
}
