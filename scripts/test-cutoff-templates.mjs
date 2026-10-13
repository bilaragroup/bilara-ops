import fs from 'node:fs';import ts from 'typescript';import ExcelJS from 'exceljs';import assert from 'node:assert/strict';
const dir='work/cutoff-tests';fs.mkdirSync(dir,{recursive:true});for(const name of ['calculations','weekly','request-policy','settings','rate-card','imports']){const code=ts.transpileModule(fs.readFileSync('lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/from '(\.\/[^']+)'/g,"from '$1.mjs'");fs.writeFileSync(dir+'/'+name+'.mjs',code);}
const {template}=await import('../'+dir+'/imports.mjs');
for(const [kind,type] of [['request','Planned'],['adhoc','Ad hoc']]){const b=await template(kind,'120','2026-09-17');const w=new ExcelJS.Workbook();await w.xlsx.load(b);assert.equal(w.getWorksheet('Requests').getCell('B2').value,type);fs.writeFileSync(dir+'/'+kind+'.xlsx',b);}
console.log('PASS: separate planned and ad hoc templates use the correct request type.');
