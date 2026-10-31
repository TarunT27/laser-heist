import assert from 'node:assert/strict';
import test from 'node:test';
import {MAPS,CREW_PERKS,ROLE_BONUSES,crewJobs,crewPerk,createHeistState,startHeist,stepHeist,sectorTiming,interactionHint,canOccupyHeist,gateOpen,type HeistInput,type Role} from '../../shared/heist';
import {findPath} from '../../client/heist/navigation';
import {makeRun,finishRun,roles} from './heist-route';

const still:HeistInput={x:0,z:0,interact:false};
const use=(s:ReturnType<typeof makeRun>,id:string,seconds:number)=>{for(let i=0;i<Math.round(seconds*30);i++)stepHeist(s,{[id]:{x:0,z:0,interact:true}},1/30);};
const jobFor=(level:number,role:Role)=>crewJobs(level).find(o=>o.role===role)!;
function withGuards(level:number,role:Role='hacker'){const s=createHeistState('J','p',[{id:'p',name:'P',role}]);s.level=level;startHeist(s);return s;}

test('every map has one optional crew job per role, each with its own perk, reachable on foot',()=>{
 for(let level=0;level<3;level++){
  const jobs=crewJobs(level);
  assert.deepEqual(jobs.map(o=>o.role).sort(),[...roles].sort(),`map ${level} roles`);
  assert.equal(new Set(jobs.map(o=>o.perk)).size,4,`map ${level} perks`);
  for(const o of jobs){
   assert.ok(o.optional,`${o.id} must stay optional`);
   if(o.perk==='lasers')assert.ok(o.sectors?.length&&o.sectors.every(id=>MAPS[level].sectors.some(h=>h.id===id)),`${o.id} names real sectors`);
   const s=makeRun(level,['hacker']);s.completed=['entry','isolate'];const p={...s.players[0],crouching:true};
   const end=findPath(s,p,o).at(-1)??p;
   assert.ok(Math.hypot(end.x-o.x,end.z-o.z)<1.5,`map ${level}: ${o.id} unreachable`);
  }
 }
});

test('only the matching role can do a crew job; anyone else is told whose job it is',()=>{
 const s=makeRun(1,['carrier','hacker']),o=jobFor(1,'hacker'),[carrier,hacker]=s.players;s.completed=['entry'];
 Object.assign(carrier,{x:o.x+.8,z:o.z});use(s,'p0',6);
 assert.ok(!s.completed.includes(o.id));assert.match(interactionHint(s,carrier).text,/^Hacker's crew job/);
 Object.assign(carrier,{x:-3,z:9});Object.assign(hacker,{x:o.x+.8,z:o.z});use(s,'p1',4.2);
 assert.ok(s.completed.includes(o.id));assert.equal(s.credits[o.id],'p1');assert.ok(crewPerk(s,'cameras'));
});

test('looping the feeds keeps every camera dark for the rest of the run',()=>{
 const s=withGuards(1);s.completed=['entry'];stepHeist(s,{p:still},1/30);
 const cams=()=>s.guards.filter(g=>g.kind==='camera');assert.ok(cams().length>0);assert.ok(cams().every(g=>g.mode!=='stunned'));
 s.completed.push(jobFor(1,'hacker').id);for(let i=0;i<30*60;i++)stepHeist(s,{p:still},1/30);
 assert.ok(cams().every(g=>g.mode==='stunned'));
});

test('cutting the relay disarms exactly its sectors for good',()=>{
 for(let level=0;level<3;level++){
  const s=makeRun(level,['infiltrator']),o=jobFor(level,'infiltrator');s.completed=['entry',o.id];
  for(let t=0;t<40;t+=.5){s.elapsed=t;for(const h of MAPS[level].sectors){const timing=sectorTiming(s,h);if(o.sectors!.includes(h.id)){assert.equal(timing.active,false);assert.equal(timing.cut,true);}else assert.equal(timing.cut,false);}}
 }
});

test('staged escape gear adds time and lets anyone haul at Carrier speed',()=>{
 const s=makeRun(0,['hacker','carrier']),o=jobFor(0,'carrier'),carrier=s.players[1];s.completed=['entry'];
 Object.assign(carrier,{x:o.x-.8,z:o.z});const before=s.remaining;use(s,'p1',4.2);
 assert.ok(s.completed.includes(o.id));assert.ok(s.remaining>before+CREW_PERKS.HAUL_SECONDS-5,'the clock gains time');
 const speed=(perk:boolean)=>{const r=makeRun(0,['hacker']),p=r.players[0];if(perk)r.completed.push(o.id);Object.assign(p,{x:-12,z:10.5,carrying:true});
  for(let i=0;i<60;i++)stepHeist(r,{p0:{x:1,z:0,interact:false}},1/30);return Math.hypot(p.vx,p.vz);};
 assert.ok(Math.abs(speed(false)-ROLE_BONUSES.NON_CARRIER_LOOT_SPEED)<.1);assert.ok(Math.abs(speed(true)-ROLE_BONUSES.CARRIER_LOOT_SPEED)<.1);
});

test('a tapped radio makes guards slower to notice the crew',()=>{
 const watch=(perk:boolean)=>{const s=withGuards(0),g=s.guards[0],p=s.players[0];for(const other of s.guards.slice(1)){other.mode='stunned';other.timer=1e6;}
  if(perk)s.completed.push('entry',jobFor(0,'lookout').id);g.x=-4;g.z=2.6;g.yaw=Math.PI/2;g.timer=60;p.x=0;p.z=2;
  for(let i=0;i<15;i++)stepHeist(s,{p:still},1/30);return g.suspicion;};
 const plain=watch(false),tapped=watch(true);
 assert.ok(plain>.05);assert.ok(Math.abs(tapped/plain-CREW_PERKS.RADIO_SUSPICION)<.05,`${tapped} vs ${plain}`);
});

test('the vault door swings open into the freight corridor and its resting leaf is solid',()=>{
 const s=makeRun(1,['carrier']),p={...s.players[0],crouching:false},rear=MAPS[1].gates.find(g=>g.id==='rear')!;
 s.completed=['entry','auth-west','auth-east'];assert.equal(gateOpen(s,rear),false);
 assert.equal(canOccupyHeist(s,p,0,-7),false);assert.equal(canOccupyHeist(s,p,-4.5,-8),true);
 s.completed.push('isolate');assert.equal(gateOpen(s,rear),true);
 assert.equal(canOccupyHeist(s,p,0,-7),true,'the round opening is walkable');assert.equal(canOccupyHeist(s,p,-4.5,-8),false,'the open door blocks where it rests');
 assert.equal(canOccupyHeist(s,p,1.8,-7.2),false,'the portal piers stay solid');
});

test('a full crew that does all four jobs still extracts, and no slower than without them',()=>{
 for(let level=0;level<3;level++){
  const plain=finishRun(makeRun(level,[...roles]));
  const helped=makeRun(level,[...roles]);helped.completed.push(...crewJobs(level).map(o=>o.id));finishRun(helped);
  assert.equal(plain.phase,'won');assert.equal(helped.phase,'won',helped.notice);
  assert.ok(helped.elapsed<=plain.elapsed+1,`map ${level}: ${helped.elapsed.toFixed(1)}s with jobs vs ${plain.elapsed.toFixed(1)}s without`);
  console.log(`CREW JOBS map=${level} without=${plain.elapsed.toFixed(1)}s with=${helped.elapsed.toFixed(1)}s`);
 }
});
