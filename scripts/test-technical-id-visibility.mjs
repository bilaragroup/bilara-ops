import fs from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

const dir = 'work/technical-id-tests';
fs.mkdirSync(dir, { recursive: true });
for (const name of ['calculations', 'request-policy', 'settings', 'weekly', 'rate-card', 'imports', 'backup']) {
  const code = ts
    .transpileModule(fs.readFileSync('lib/' + name + '.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'");
  fs.writeFileSync(dir + '/' + name + '.mjs', code);
}
const { template, parseUpload } = await import('../' + dir + '/imports.mjs');
const { backupFiles } = await import('../' + dir + '/backup.mjs');

const record = {
  id: 'request-technical-key-1',
  kind: 'plan',
  project: '123',
  window: '2026-10-01',
  due: '2026-10-02',
  item: 'Cement',
  unit: 'BAG',
  demandQty: 10,
  boqQty: 10,
  stage: 'Submitted',
  serial: 1,
  milestone: '1',
  activity: '4',
  activityName: 'Masonry',
  activityBoqQty: 100,
  owner: 'Owner',
  itemCategory: 'Materials',
};

const existingBook = new ExcelJS.Workbook();
await existingBook.xlsx.load(await template('request', '123', '2026-10-01', [record], true));
const existingSheet = existingBook.getWorksheet('Requests');
const requestIdColumn = existingSheet.getRow(1).values.indexOf('Request ID');
assert.ok(requestIdColumn > 0, 'existing export must retain Request ID for matching');
assert.equal(existingSheet.getColumn(requestIdColumn).hidden, true);
assert.equal(existingSheet.getCell(2, requestIdColumn).text, record.id);
const parsed = await parseUpload(await existingBook.xlsx.writeBuffer(), 'request', [record]);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].data.id, record.id, 'hidden Request ID must still resolve the update');
assert.equal(parsed[0].errors.length, 0);

for (const [kind, sheetName, idHeading, row] of [
  ['boq', 'BOQ Review', 'Request ID', { ...record, boqOriginalRate: 400, boqRate: 380 }],
  ['vendor', 'Vendor Sourcing', 'Request ID', { ...record, stage: 'BOQ priced', boqRate: 380 }],
  ['payment', 'Payments', 'Payment ID', { id: 'payment-technical-key-1', kind: 'payment', project: '123', window: '2026-10-01', item: 'Cement', amount: 10, due: '2026-10-02', vendor: 'Vendor', category: 'Material' }],
]) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await template(kind, '123', '2026-10-01', [row], true));
  const sheet = book.getWorksheet(sheetName);
  const column = sheet.getRow(1).values.indexOf(idHeading);
  assert.ok(column > 0, `${kind} export must retain ${idHeading}`);
  assert.equal(sheet.getColumn(column).hidden, true, `${kind} ${idHeading} must be hidden`);
}

const purchase = { id: 'purchase-technical-key-1', kind: 'purchase', parent: record.id, project: '123', window: record.window, item: record.item, qty: 10, rate: 350, status: 'Ordered', vendor: 'Vendor', entity: 'GROUP', stage: 'Audit approved' };
const payment = { id: 'payment-technical-key-1', kind: 'payment', parent: purchase.id, project: '123', window: record.window, item: record.item, total: 1000, paid: 0, status: 'Pending', vendor: 'Vendor', entity: 'GROUP', category: 'Material', due: record.due };
const zip = await JSZip.loadAsync(await backupFiles({ window: record.window, project: '123', records: [record, purchase, payment], history: [], documents: [], created: '2026-09-26T00:00:00.000Z' }));
for (const [file, sheetName, headings] of [
  ['Purchase Plan 2026-10-01.xlsx', record.window + ' to 2026-10-07', ['Requirement ID', 'Purchase ID']],
  ['Payment Forecast 2026-10-01.xlsx', record.window + ' to 2026-10-07', ['Payment ID', 'Purchase ID']],
]) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await zip.file(file).async('nodebuffer'));
  const sheet = book.getWorksheet(sheetName);
  for (const heading of headings) {
    const column = sheet.getRow(1).values.indexOf(heading);
    assert.ok(column > 0, `${file} must retain ${heading}`);
    assert.equal(sheet.getColumn(column).hidden, true, `${file} ${heading} must be hidden`);
  }
}

console.log('PASS: technical ID columns remain in Excel for exact matching but are hidden from normal review.');
