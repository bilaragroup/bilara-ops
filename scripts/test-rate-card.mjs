import assert from 'node:assert/strict';
import {parseRateCard,RATE_CARD_ITEMS} from '../lib/rate-card.ts';
import {findProjectRate,purchaseTarget} from '../lib/settings.ts';

const headers=['Project Number',...RATE_CARD_ITEMS],values=[headers,['120','1000','410','','85.5']];
const result=parseRateCard(values,[],5);assert.equal(result.projectCount,1);assert.equal(result.rateCount,3);assert.equal(result.rates[0].project,'120');assert.equal(result.rates[0].unit,'*');
const cement=findProjectRate({projectRates:result.rates},'120','Cement','BAG');assert.equal(cement.originalRate,410);assert.equal(purchaseTarget(cement),389.5);
assert.equal(findProjectRate({projectRates:result.rates},'120','20mm Metal','CFT').originalRate,85.5);
assert.throws(()=>parseRateCard([headers,['99','100']],[],5),/100 to 999/);assert.throws(()=>parseRateCard([headers,['120','100'],['120','110']],[],5),/appears more than once/);assert.throws(()=>parseRateCard([['Project',...RATE_CARD_ITEMS]],[],5),/headings/);
console.log('PASS: wide project rate card parsing, blank cells, wildcard unit matching, 5% target, project and heading validation.');
