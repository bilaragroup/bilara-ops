// Excel side of the BOQ schedule (browser only; loaded on demand).
import ExcelJS from 'exceljs';
import { RATE_CARD_ITEMS, RATE_CARD_ITEM_DEFAULTS } from './rate-card';
import { BOQ_SCHEDULE_COLUMNS, BOQ_SCHEDULE_SHEET, MAX_SCHEDULE_LINES, type BoqLine } from './boq-schedule';

const PREFILLED_ROWS = 1000;

/** Template for one project: the current schedule if there is one, otherwise blank rows. */
export async function scheduleTemplate(project: string, projectName: string, lines: BoqLine[], milestones: string[]) {
  const book = new ExcelJS.Workbook();
  book.creator = 'Bilara';
  const sheet = book.addWorksheet(BOQ_SCHEDULE_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  const help = book.addWorksheet('How to fill');
  const lists = book.addWorksheet('Lists', { state: 'veryHidden' });

  sheet.columns = [10, 11, 12, 34, 30, 10, 18, 30].map((width, i) => ({ header: BOQ_SCHEDULE_COLUMNS[i], width }));
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF006A60' } };
  head.alignment = { vertical: 'middle', wrapText: true };
  head.height = 30;

  const sorted = [...lines].sort(
    (a, b) =>
      Number(a.milestone) - Number(b.milestone) ||
      Number(a.activity) - Number(b.activity) ||
      a.item.localeCompare(b.item),
  );
  for (const l of sorted)
    sheet.addRow([project, l.milestone, Number(l.activity), l.activityName, l.item, l.unit, l.qty, l.notes || '']);

  // Lists for the dropdowns live on a hidden sheet so long lists are not cut off.
  milestones.forEach((m, i) => (lists.getCell(i + 1, 1).value = m));
  RATE_CARD_ITEMS.forEach((item, i) => {
    lists.getCell(i + 1, 2).value = item;
    lists.getCell(i + 1, 3).value = RATE_CARD_ITEM_DEFAULTS[item]?.unit || '';
  });
  const last = Math.min(MAX_SCHEDULE_LINES, Math.max(PREFILLED_ROWS, sorted.length + 200)) + 1;
  for (let r = 2; r <= last; r++) {
    if (r > sorted.length + 1) sheet.getCell(r, 1).value = project;
    sheet.getCell(r, 2).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`Lists!$A$1:$A$${Math.max(1, milestones.length)}`],
      showErrorMessage: true, errorTitle: 'Milestone', error: 'Choose a milestone from the list.',
    };
    sheet.getCell(r, 3).dataValidation = {
      type: 'whole', operator: 'between', allowBlank: true, formulae: [1, 999],
      showErrorMessage: true, errorTitle: 'Activity No.', error: 'Enter a whole number from 1 to 999.',
    };
    // Standard items are offered, but any other item name is allowed (warning only).
    sheet.getCell(r, 5).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`Lists!$B$1:$B$${RATE_CARD_ITEMS.length}`],
      showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Item',
      error: 'Not a standard item. Keep it only if the item is really different from the list.',
    };
    sheet.getCell(r, 7).dataValidation = {
      type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0],
      showErrorMessage: true, errorTitle: 'Approved Quantity', error: 'Enter a quantity greater than zero.',
    };
    sheet.getCell(r, 7).numFmt = '#,##0.###';
  }

  help.columns = [{ width: 110 }];
  [
    [`BOQ schedule · Project ${project}${projectName ? ' · ' + projectName : ''}`, true],
    ['One row per item per activity. Bilara uses the Approved Quantity to check every purchase request for that activity.', false],
    ['', false],
    ['Project: already filled in. Do not change it; the upload refuses rows for another project.', false],
    [`Milestone: choose from the list (${milestones.join(', ')}).`, false],
    ['Activity No.: the activity number the PM will choose, 1 to 999. Activity Name: the same name on every row of that activity.', false],
    ['Item: pick a standard item where possible (same names as the request form), otherwise type the item.', false],
    ['Unit: BAG, KG, CFT, NOS… Use the same unit the PM will request in. Standard units: ' + RATE_CARD_ITEMS.map((i) => `${i} ${RATE_CARD_ITEM_DEFAULTS[i]?.unit}`).join(', ') + '.', false],
    ['Approved Quantity: the total approved for that item in that activity, not per week.', false],
    ['Notes: optional.', false],
    ['', false],
    ['Uploading replaces this project\'s schedule. You will see what is added, changed and removed before anything is saved.', false],
    ['Requests already priced keep the quantity they were checked against; new and still-submitted requests use the new schedule.', false],
    ['No rates go in this sheet. Rates stay in Settings → Project rate catalogue.', false],
  ].forEach(([text, bold], i) => {
    const c = help.getCell(i + 1, 1);
    c.value = text as string;
    c.font = bold ? { bold: true, size: 14 } : {};
    c.alignment = { wrapText: true, vertical: 'top' };
  });

  const buffer = await book.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** Read the uploaded template into plain rows (heading row first). */
export async function readScheduleFile(file: File): Promise<unknown[][]> {
  if (file.size > 5 * 1024 * 1024) throw Error('Use an XLSX file under 5 MB.');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await file.arrayBuffer()) as any);
  const sheet = book.getWorksheet(BOQ_SCHEDULE_SHEET) || book.worksheets[0];
  if (!sheet) throw Error('The workbook has no worksheet.');
  const values: unknown[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row, n) => {
    values[n - 1] = Array.from({ length: BOQ_SCHEDULE_COLUMNS.length }, (_, i) => {
      const cell = row.getCell(i + 1);
      if (cell.type === ExcelJS.ValueType.Formula) return (cell.value as any)?.result ?? '';
      const v: any = cell.value;
      if (v && typeof v === 'object' && 'richText' in v) return v.richText.map((t: any) => t.text).join('');
      return typeof v === 'number' ? v : cell.text;
    });
  });
  for (let i = 0; i < values.length; i++) values[i] ||= [];
  return values;
}
