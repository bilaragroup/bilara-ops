import type {ProjectRate} from './settings';

export const RATE_CARD_URL='https://docs.google.com/spreadsheets/d/1h3dJG5tZcZe3h-OTXqtCMGoAXMcH1-Zcss3rjxxrfRU/edit?gid=0#gid=0';
export const RATE_CARD_EXPORT_URL='https://docs.google.com/spreadsheets/d/1h3dJG5tZcZe3h-OTXqtCMGoAXMcH1-Zcss3rjxxrfRU/export?format=xlsx&gid=0';
export const RATE_CARD_ITEMS=['Hitachi','Cement','MSand','20 mm Metal','PSand','Solid Cement Blocks 12 x 8 x 6','Solid Cement Blocks 12 x 8 x 4','Red Bricks','Laterite Stone','8 mm Steel','10 mm Steel','12 mm Steel','16 mm Steel','20 mm Steel','Tile Gum','Shuttering Items'] as const;
export const RATE_CARD_ITEM_DEFAULTS:Record<string,{itemCategory:string;unit:string}>={
 'Hitachi':{itemCategory:'Tools & Equipment',unit:'HOUR'},'Cement':{itemCategory:'Materials',unit:'BAG'},'MSand':{itemCategory:'Materials',unit:'CFT'},'20 mm Metal':{itemCategory:'Materials',unit:'CFT'},'PSand':{itemCategory:'Materials',unit:'CFT'},
 'Solid Cement Blocks 12 x 8 x 6':{itemCategory:'Materials',unit:'NOS'},'Solid Cement Blocks 12 x 8 x 4':{itemCategory:'Materials',unit:'NOS'},'Red Bricks':{itemCategory:'Materials',unit:'NOS'},'Laterite Stone':{itemCategory:'Materials',unit:'NOS'},
 '8 mm Steel':{itemCategory:'Materials',unit:'KG'},'10 mm Steel':{itemCategory:'Materials',unit:'KG'},'12 mm Steel':{itemCategory:'Materials',unit:'KG'},'16 mm Steel':{itemCategory:'Materials',unit:'KG'},'20 mm Steel':{itemCategory:'Materials',unit:'KG'},'Tile Gum':{itemCategory:'Materials',unit:'KG'},'Shuttering Items':{itemCategory:'Tools & Equipment',unit:'LOT'}
};

const text=(value:any)=>String(value??'').trim();
const number=(value:any)=>Number(text(value).replace(/[₹,\s]/g,''));
const key=(project:string,item:string)=>`${project}|${item.toLowerCase()}`;

export function parseRateCard(values:any[][],existing:ProjectRate[],discountPercent:number){
 if(!values.length)throw Error('The workbook is empty.');
 const headers=values[0].map((value:any)=>text(value).replace(/^\uFEFF/,'').replace(/\s+/g,' ')),expected=['Project Number',...RATE_CARD_ITEMS];
 if(expected.some((heading,index)=>headers[index]!==heading))throw Error('Use the BilaraRateCard headings without renaming or reordering columns.');
 const seenProjects=new Set<string>(),rates:ProjectRate[]=[];let populatedRows=0;
 for(let row=1;row<values.length;row++){
  if(!values[row]?.some(v=>text(v)))continue;
  const project=text(values[row][0]).replace(/\.0+$/,'');
  if(!/^[1-9][0-9]{2}$/.test(project))throw Error(`Row ${row+1}: Project Number must be from 100 to 999.`);
  if(seenProjects.has(project))throw Error(`Row ${row+1}: Project ${project} appears more than once.`);seenProjects.add(project);
  let count=0;
  RATE_CARD_ITEMS.forEach((item,index)=>{const raw=values[row][index+1];if(!text(raw))return;const originalRate=number(raw);if(!Number.isFinite(originalRate)||originalRate<=0||originalRate>1e9)throw Error(`Row ${row+1}: ${item} needs a positive rate.`);rates.push({id:`rate-card:${project}:${index+1}`,project,item,unit:'*',originalRate,discountPercent,active:true,source:'BilaraRateCard'});count++;});
  if(count)populatedRows++;
 }
 if(!rates.length)throw Error('No rates were found. Add a project number and at least one item rate, then import again.');
 const importedKeys=new Set(rates.map(r=>key(r.project,r.item))),manual=existing.filter(r=>r.source!=='BilaraRateCard'&&!importedKeys.has(key(r.project,r.item)));
 return {rates:[...manual,...rates],rateCount:rates.length,projectCount:populatedRows};
}

/**
 * A rate-card spreadsheet as the BOQ Team keeps it: first column "Project Number", then one
 * column per item with the BOQ rate. One row per project; a row may also cover a range of
 * projects ("120-150"). Blank cells mean the item is not on that card. Any item column is
 * accepted (no fixed template). If a project appears twice, its rows are combined and a
 * warning says so; the later row wins where both rows have a rate.
 */
export type SheetCard={scope:'default'|'project'|'range';project:string;fromProject?:string;toProject?:string;row:number;lines:{item:string;originalRate:number}[]};
export function parseRateSheet(values:any[][]){
 if(!values.length)throw Error('The spreadsheet is empty.');
 const headers=values[0].map((v:any)=>text(v).replace(/^﻿/,'').replace(/\s+/g,' '));
 if(!/^project( number| no\.?)?$/i.test(headers[0]||''))throw Error('Put the project number in the first column, with the heading "Project Number".');
 const items:{index:number;item:string}[]=[];const seenItems=new Set<string>();
 headers.forEach((h,i)=>{if(i===0||!h)return;const k=h.toLowerCase();if(seenItems.has(k))throw Error(`The item "${h}" has two columns. Keep one.`);seenItems.add(k);items.push({index:i,item:h});});
 if(!items.length)throw Error('Add one column per item after "Project Number", with the item name as the heading.');
 const cards=new Map<string,SheetCard>(),warnings:string[]=[];
 for(let row=1;row<values.length;row++){
  const cells=values[row]||[];if(!cells.some(v=>text(v)))continue;
  const raw=text(cells[0]).replace(/\.0+$/,'').replace(/\s+/g,'');
  if(/^(default|all|allprojects)$/i.test(raw)){
   // The default card: every project without its own card or range.
   const lines:{item:string;originalRate:number}[]=[];
   for(const {index,item} of items){const v=cells[index];if(!text(v))continue;const rate=number(v);if(!Number.isFinite(rate)||rate<=0||rate>1e9)throw Error(`Row ${row+1}: ${item} needs a positive rate (found "${text(v)}").`);lines.push({item,originalRate:rate});}
   if(cards.has('default'))throw Error(`Row ${row+1}: the default rate card is on two rows. Keep one.`);
   cards.set('default',{scope:'default',project:'',row,lines});continue;
  }
  const m=/^([1-9][0-9]{2})(?:[-–to]+([1-9][0-9]{2}))?$/i.exec(raw);
  if(!m)throw Error(`Row ${row+1}: "${text(cells[0])}" is not a project number (100–999), a range such as 120-150, or Default.`);
  const range=!!m[2]&&m[2]!==m[1];
  if(range&&Number(m[1])>Number(m[2]))throw Error(`Row ${row+1}: write the range from the smaller project number, e.g. ${m[2]}-${m[1]}.`);
  const key=range?`range:${m[1]}-${m[2]}`:`project:${m[1]}`;
  const lines:{item:string;originalRate:number}[]=[];
  for(const {index,item} of items){const v=cells[index];if(!text(v))continue;const rate=number(v);if(!Number.isFinite(rate)||rate<=0||rate>1e9)throw Error(`Row ${row+1}: ${item} needs a positive rate (found "${text(v)}").`);lines.push({item,originalRate:rate});}
  const old=cards.get(key);
  if(old){
   const conflicts=lines.filter(l=>old.lines.some(o=>o.item===l.item&&o.originalRate!==l.originalRate)).map(l=>l.item);
   warnings.push(`${range?'Projects '+m[1]+'–'+m[2]:'Project '+m[1]} is on rows ${old.row+1} and ${row+1}; they were combined${conflicts.length?` and row ${row+1} was used for ${conflicts.join(', ')}`:''}.`);
   for(const l of lines){const i=old.lines.findIndex(o=>o.item===l.item);if(i>=0)old.lines[i]=l;else old.lines.push(l);}
   continue;
  }
  cards.set(key,range?{scope:'range',project:'',fromProject:m[1],toProject:m[2],row,lines}:{scope:'project',project:m[1],row,lines});
 }
 const list=[...cards.values()].filter(c=>c.lines.length);
 const empty=[...cards.values()].filter(c=>!c.lines.length);
 if(empty.length)warnings.push(`No rates on the row for ${empty.map(c=>c.scope==='default'?'Default':c.scope==='range'?c.fromProject+'–'+c.toProject:c.project).join(', ')}; ${empty.length===1?'it was':'they were'} skipped.`);
 if(!list.length)throw Error('No rates were found. Fill at least one rate, then upload again.');
 return {cards:list,warnings,rateCount:list.reduce((n,c)=>n+c.lines.length,0)};
}

export type RateTarget={type:'default'}|{type:'project';project:string}|{type:'range';from:string;to:string};
const targetKey=(t:RateTarget)=>t.type==='default'?'default':t.type==='range'?`range:${t.from}-${t.to}`:`project:${t.project}`;
const targetText=(t:RateTarget)=>t.type==='default'?'the default rate card':t.type==='range'?`projects ${t.from}–${t.to}`:`project ${t.project}`;
/**
 * The rates for one chosen card from an uploaded sheet. Two layouts are read:
 *  - the BOQ Team's sheet: "Project Number" then one column per item. The row for the chosen
 *    card is used (its project number, range like 120-150, or "Default"); a row whose first cell
 *    is blank is taken as the chosen card.
 *  - a list: Item, Unit, BOQ rate, Reduction % (one row per item).
 * Unit blank = any unit; Reduction blank = left as it is (5% for new items).
 */
export function sheetLinesFor(values:any[][],target:RateTarget){
 if(!values.length)throw Error('The spreadsheet is empty.');
 const head=(values[0]||[]).map((v:any)=>text(v).replace(/^﻿/,'').replace(/\s+/g,' ').toLowerCase());
 if(/^project( number| no\.?)?$/.test(head[0]||'')){
  const fill=target.type==='default'?'Default':target.type==='range'?`${target.from}-${target.to}`:target.project;
  const rows=values.map((r,i)=>i>0&&!text(r?.[0])&&(r||[]).some((v:any)=>text(v))?[fill,...r.slice(1)]:r);
  const sheet=parseRateSheet(rows);
  const card=sheet.cards.find(c=>(c.scope==='default'?'default':c.scope==='range'?`range:${c.fromProject}-${c.toProject}`:`project:${c.project}`)===targetKey(target));
  if(!card)throw Error(`The sheet has no row for ${targetText(target)}. Put ${target.type==='default'?'"Default"':fill} in the Project Number column (or leave it blank on a one-row sheet), or go back and choose "Several projects from the sheet".`);
  return {lines:card.lines.map(l=>({item:l.item,unit:'',originalRate:l.originalRate,discountPercent:''})),others:sheet.cards.length-1,warnings:sheet.warnings};
 }
 const col=(names:string[])=>head.findIndex((h:string)=>names.includes(h));
 const ci=col(['item','items']),cu=col(['unit']),cr=col(['boq rate','rate','boq rate (₹)']),cd=col(['reduction %','reduction','target reduction %']);
 if(ci<0||cr<0)throw Error('Use either your rate-card sheet ("Project Number" then one column per item) or a list with the headings Item and BOQ rate.');
 const lines:any[]=[];
 values.slice(1).forEach((r,n)=>{
  const item=text(r?.[ci]),raw=text(r?.[cr]);
  if(!item||!raw)return;
  const rate=number(raw);
  if(!Number.isFinite(rate)||rate<=0||rate>1e9)throw Error(`Row ${n+2}: ${item} needs a positive BOQ rate.`);
  const d=cd>=0&&text(r?.[cd])!==''?Number(text(r[cd]).replace('%','')):'';
  if(d!==''&&(!Number.isFinite(d)||d<0||d>50))throw Error(`Row ${n+2}: reduction must be 0–50%.`);
  lines.push({item,unit:cu>=0?text(r?.[cu]):'',originalRate:rate,discountPercent:d});
 });
 if(!lines.length)throw Error('No rates were found in the sheet. Fill the rates, then upload again.');
 return {lines,others:0,warnings:[] as string[]};
}
