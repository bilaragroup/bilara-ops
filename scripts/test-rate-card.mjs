import assert from 'node:assert/strict';
import './ts-resolve.mjs';
const {parseRateCard,RATE_CARD_ITEMS,sheetLinesFor}=await import('../lib/rate-card.ts');
const {findProjectRate,purchaseTarget}=await import('../lib/settings.ts');

const headers=['Project Number',...RATE_CARD_ITEMS],values=[headers,['120','1000','410','','85.5']];
const result=parseRateCard(values,[],5);assert.equal(result.projectCount,1);assert.equal(result.rateCount,3);assert.equal(result.rates[0].project,'120');assert.equal(result.rates[0].unit,'*');
const cement=findProjectRate({projectRates:result.rates},'120','Cement','BAG');assert.equal(cement.originalRate,410);assert.equal(purchaseTarget(cement),389.5);
assert.equal(findProjectRate({projectRates:result.rates},'120','20mm Metal','CFT').originalRate,85.5);
assert.throws(()=>parseRateCard([headers,['99','100']],[],5),/100 to 999/);assert.throws(()=>parseRateCard([headers,['120','100'],['120','110']],[],5),/appears more than once/);assert.throws(()=>parseRateCard([['Project',...RATE_CARD_ITEMS]],[],5),/headings/);
console.log('PASS: wide project rate card parsing, blank cells, wildcard unit matching, 5% target, project and heading validation.');
// One card from an uploaded sheet: the row for the chosen card, a blank first cell, Default, or a list.
{const wide=[['Project Number','Cement','MSand'],['125','360',''],['120-150','380','60'],['Default','400','65']];
 assert.deepEqual(sheetLinesFor(wide,{type:'project',project:'125'}).lines.map(l=>[l.item,l.originalRate]),[['Cement',360]]);
 assert.equal(sheetLinesFor(wide,{type:'range',from:'120',to:'150'}).lines.length,2);
 assert.equal(sheetLinesFor(wide,{type:'default'}).lines[0].originalRate,400);
 assert.equal(sheetLinesFor([['Project Number','Cement'],['','370']],{type:'project',project:'130'}).lines[0].originalRate,370);
 assert.throws(()=>sheetLinesFor(wide,{type:'project',project:'131'}),/no row for project 131/);
 const list=sheetLinesFor([['Item','Unit','BOQ rate','Reduction %'],['Cement','BAG','390','7'],['PSand','','70','']],{type:'default'}).lines;
 assert.deepEqual(list,[{item:'Cement',unit:'BAG',originalRate:390,discountPercent:7},{item:'PSand',unit:'',originalRate:70,discountPercent:''}]);
 assert.throws(()=>sheetLinesFor([['Name','Price'],['x','1']],{type:'default'}),/Item and BOQ rate/);
 console.log('PASS: one card from a sheet (its row, blank row, range, Default, or an Item/BOQ rate list).');}
