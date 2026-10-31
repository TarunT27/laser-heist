import assert from 'node:assert/strict';
import test from 'node:test';
import {MAPS,createHeistState,startHeist,stepHeist,startSetup,applyFinaleMods,canOccupyHeist,setHeistLevel} from '../../shared/heist';
import {HEISTS,CREW,finaleMods,finaleReady,setupById} from '../../shared/heist-campaign';
import {findPath} from '../../client/heist/navigation';

function setupRun(level:number,id:string){
 const s=createHeistState('C','p',[{id:'p',name:'P',role:'hacker'}]);setHeistLevel(s,level);startHeist(s);
 startSetup(s,setupById(HEISTS[level],id));return s;
}

test('every setup target stands on walkable floor and can be reached on foot from the entry',()=>{
 for(const heist of HEISTS)for(const setup of heist.setups){
  const s=setupRun(heist.level,setup.id),p={...s.players[0],crouching:true};
  for(const t of setup.targets){
   assert.ok(canOccupyHeist(s,p,t.x,t.z),`${setup.id}/${t.id} is inside geometry`);
   const path=findPath(s,p,t),end=path.at(-1)??p;
   assert.ok(Math.hypot(end.x-t.x,end.z-t.z)<1.5,`${setup.id}/${t.id} unreachable from the spawn`);
  }
 }
});

test('a setup is won by finishing its targets and walking back out, with no payout',()=>{
 const s=setupRun(0,'museum-keycard');s.guards=[];const p=s.players[0],t=s.mission.kind==='setup'?s.mission.targets[0]:null!;
 p.x=t.x+0.6;p.z=t.z;
 for(let i=0;i<30*4;i++)stepHeist(s,{p:{x:0,z:0,interact:true}},1/30);
 assert.ok(t.done);assert.equal(s.phase,'playing','still has to leave');
 p.x=MAPS[0].spawns[0].x;p.z=MAPS[0].spawns[0].z;stepHeist(s,{p:{x:0,z:0,interact:false}},1/30);
 assert.equal(s.phase,'won');assert.equal(s.securedValue,0);
});

test('finale modifiers merge approach, finished setups and crew, and apply at the start',()=>{
 const heist=HEISTS[1];
 assert.equal(finaleReady(heist,'codes',[]),false);
 assert.equal(finaleReady(heist,'codes',['bank-codes']),true);
 const mods=finaleMods(heist,'inside',['bank-case','bank-bribe','bank-codes'],['wren','rosa']);
 assert.equal(mods.extraCut,10);assert.equal(mods.time,60);assert.equal(mods.blackout,120,'the bribe outlasts the hacker loop');
 assert.ok(mods.showRoutes);assert.equal(mods.preComplete,undefined,'codes belong to the other approach');
 const s=createHeistState('F','p',[{id:'p',name:'P'}]);setHeistLevel(s,1);startHeist(s);const before=s.remaining;
 applyFinaleMods(s,finaleMods(heist,'codes',['bank-codes'],['lou']));
 assert.ok(s.completed.includes('auth-west')&&s.completed.includes('auth-east'));assert.equal(s.scannerDisabled,30);assert.equal(s.remaining,before);
 assert.ok(CREW.some(c=>c.role==='hacker')&&CREW.some(c=>c.role==='driver'));
});

test('the disguise makes guards slower to suspect you',()=>{
 const time=(disguised:boolean)=>{
  const s=createHeistState('D','p',[{id:'p',name:'P'}]);startHeist(s);if(disguised)applyFinaleMods(s,finaleMods(HEISTS[0],'disguise',['museum-uniform'],[]));
  const g=s.guards[0];for(const o of s.guards.slice(1)){o.mode='stunned';o.timer=1e6;}g.x=-4;g.z=2.6;g.yaw=Math.PI/2;g.timer=60;const p=s.players[0];p.x=0;p.z=2;
  let t=0;while(g.mode!=='confront'&&t<20){stepHeist(s,{p:{x:0,z:0,interact:false}},1/30);t+=1/30;}return t;
 };
 assert.ok(time(true)>time(false)*1.6);
});
