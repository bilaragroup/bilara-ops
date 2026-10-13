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
