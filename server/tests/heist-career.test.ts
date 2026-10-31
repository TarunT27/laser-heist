import assert from 'node:assert/strict';
import test from 'node:test';
import {readCareer,recordClear} from '../../client/heist/career';
test('career saves personal payout, clean runs and per-contract best across reloads',()=>{
 let c=recordClear(readCareer(null),1,5700,0);c=readCareer(JSON.stringify(c));c=recordClear(c,1,4200,2);
 assert.deepEqual(c,{clears:2,earnings:9900,cleanRuns:1,best:[0,5700,0]});
 assert.deepEqual(readCareer('{broken'),readCareer(null));
 assert.deepEqual(readCareer('{"clears":-1,"best":[null,"bad",5]}'),{clears:0,earnings:0,cleanRuns:0,best:[0,0,5]});
});
