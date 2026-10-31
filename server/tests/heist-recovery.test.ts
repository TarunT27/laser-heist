import assert from 'node:assert/strict';import test from 'node:test';
import {MAPS,stepHeist,setHeistPlayerConnected,gateOpen,canOccupyHeist,createHeistState,startHeist} from '../../shared/heist';
import {makeRun,RouteDriver,finishRun} from './heist-route';
for(let level=0;level<3;level++)test(`map ${level}: carrier disconnect preserves theft and reachable cargo`,()=>{
 const s=makeRun(level,['hacker','hacker']),driver=new RouteDriver(s);
 for(let i=0;i<10000&&!s.cargo.loaded;i++)stepHeist(s,driver.inputs(),1/30);
 assert.ok(s.cargo.loaded);const cargo={x:s.cargo.x,z:s.cargo.z},done=[...s.completed];
 setHeistPlayerConnected(s,'p0',false);assert.equal(s.carrierId,null);assert.equal(s.diamondTaken,true);assert.deepEqual(s.completed,done);assert.equal(s.cargo.x,cargo.x);assert.equal(s.cargo.z,cargo.z);
 const before=s.remaining;stepHeist(s,{},1);assert.equal(s.remaining,before);assert.ok(s.recovery>0);
 // The survivor can navigate back to the dropped cargo even after lockdown.
 const survivor=s.players[1],nav=driver.nav;
 for(let i=0;i<6000&&!s.cargo.controller;i++){
 const d=Math.hypot(survivor.x-s.cargo.x,survivor.z-s.cargo.z);const move=d<1?{x:0,z:0}:nav.steer(s,{...survivor,crouching:true},s.cargo,s.elapsed*1000);
 stepHeist(s,{p1:{...move,crouch:true,interact:d<1}},1/30);
 }
 assert.equal(s.cargo.controller,'p1');assert.equal(finishRun(s).phase,'won');
 const remaining=s.remaining;setHeistPlayerConnected(s,'p0',true);setHeistPlayerConnected(s,'p0',false);assert.equal(s.remaining,remaining);
});
test('clamp requires uninterrupted six seconds, only one installed per player, survives owner disconnect',()=>{
 const s=makeRun(1,['hacker','hacker']);s.completed=['entry','auth-west','auth-east','isolate'];
 const p=s.players[0],a=MAPS[1].objectives.find(o=>o.id==='gate-a')!,b=MAPS[1].objectives.find(o=>o.id==='gate-b')!;
 Object.assign(p,{x:a.x,z:a.z});for(let i=0;i<90;i++)stepHeist(s,{p0:{x:0,z:0,interact:true}},1/30);
 assert.ok(s.clamps['gate-a'].progress<1);stepHeist(s,{},1/30);assert.equal(Object.hasOwn(s.clamps,'gate-a'),false);
 for(let i=0;i<181;i++)stepHeist(s,{p0:{x:0,z:0,interact:true}},1/30);assert.ok(s.clamps['gate-a'].installed);
 Object.assign(p,{x:b.x,z:b.z});for(let i=0;i<200;i++)stepHeist(s,{p0:{x:0,z:0,interact:true}},1/30);assert.equal(Object.hasOwn(s.clamps,'gate-b'),false);
 setHeistPlayerConnected(s,p.id,false);assert.ok(s.clamps['gate-a'].installed);
});
test('closed gates block collision, theft closes entrance without resetting return routes',()=>{
 const s=makeRun(0,['carrier']),p=s.players[0],m=MAPS[0];assert.equal(canOccupyHeist(s,p,0,4),false);
 s.completed=['entry','isolate'];assert.equal(canOccupyHeist(s,p,0,4),true);s.diamondTaken=true;
 assert.equal(canOccupyHeist(s,p,0,4),false);assert.equal(gateOpen(s,m.gates.find(g=>g.id==='north')!,p),true);
 assert.equal(gateOpen(s,m.gates.find(g=>g.id==='return')!,p),true);
});
test('timeout wins over extraction, all connected players and cargo are required',()=>{
 const s=makeRun(0,['carrier','carrier']),m=MAPS[0];s.cargo={...m.exit,loaded:true,controller:null};s.diamondTaken=true;
 Object.assign(s.players[0],m.exit);stepHeist(s,{p0:{x:0,z:0,interact:true}},2);assert.equal(s.phase,'playing');
 Object.assign(s.players[1],m.exit);s.remaining=.01;stepHeist(s,{p0:{x:0,z:0,interact:true}},.1);assert.equal(s.phase,'lost');
});
test('two identical roles can hold and override immediately without installing a clamp',()=>{
 const s=makeRun(0,['carrier','carrier']);s.completed=['entry'];Object.assign(s.players[0],{x:8,z:6});Object.assign(s.players[1],{x:11,z:0});
 for(let i=0;i<100;i++)stepHeist(s,{p0:{x:0,z:0,interact:true},p1:{x:0,z:0,interact:true}},1/30);
 assert.ok(s.completed.includes('isolate'));assert.equal(Object.keys(s.clamps).length,0);
});
