import assert from 'node:assert/strict';
import test from 'node:test';
import {makeRun,finishRun,roles} from './heist-route';
for(let level=0;level<3;level++)for(const role of roles)test(`map ${level+1}: true solo ${role}, physical route and cargo`,()=>{
 const s=finishRun(makeRun(level,[role]));
 assert.equal(s.phase,'won',JSON.stringify({notice:s.notice,time:s.elapsed,completed:s.completed,cargo:s.cargo,players:s.players}));
 assert.equal(s.escaped.length,1);assert.equal(s.payouts.reduce((n,p)=>n+p.amount,0),s.securedValue);
 console.log(`ROUTE map=${level} role=${role} elapsed=${s.elapsed.toFixed(1)} alarms=${s.alarms} remaining=${s.remaining.toFixed(1)}`);
});
for(let level=0;level<3;level++)for(let a=0;a<4;a++)for(let b=a;b<4;b++)test(`map ${level+1}: pair ${roles[a]} + ${roles[b]}`,()=>{
 const s=finishRun(makeRun(level,[roles[a],roles[b]]));assert.equal(s.phase,'won',JSON.stringify({notice:s.notice,completed:s.completed,cargo:s.cargo,players:s.players}));assert.equal(s.escaped.length,2);
});
for(let level=0;level<3;level++)for(const count of [3,4])test(`map ${level+1}: ${count} connected humans extract together`,()=>{
 const s=finishRun(makeRun(level,Array.from({length:count},()=> 'carrier' as const)));assert.equal(s.phase,'won');assert.equal(s.escaped.length,count);
});
