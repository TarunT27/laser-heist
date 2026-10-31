import assert from 'node:assert/strict';
import test from 'node:test';
import {MAPS,GUARD_CONSTANTS,HEIST_CONSTANTS,createHeistState,startHeist,stepHeist,guardVisibility,takedownTarget,sectorTiming,setHeistDifficulty,talkNeedle,type HeistInput} from '../../shared/heist';

const still:HeistInput={x:0,z:0,interact:false};
function solo(level=0,role:'hacker'|'infiltrator'|'carrier'|'lookout'='hacker'){
 const s=createHeistState('G','p',[{id:'p',name:'P',role}]);s.level=level;startHeist(s);return s;
}
/** Park every guard except the first far away and asleep so one behaviour is tested at a time. */
function isolate(s:ReturnType<typeof solo>){for(const g of s.guards.slice(1)){g.mode='stunned';g.timer=1e6;}return s.guards[0];}

/** Stand in the gallery guard's view until he stops the player; returns the confrontation. */
function stopped(s:ReturnType<typeof solo>){
 const g=isolate(s),p=s.players[0];g.x=-4;g.z=2.6;g.yaw=Math.PI/2;g.timer=60;p.x=0;p.z=2;
 for(let i=0;i<30*8&&!s.confrontations.length;i++)stepHeist(s,{p:still},1/30);
 assert.equal(s.confrontations.length,1,'the guard stops the player');assert.equal(g.mode,'confront');
 return {g,p,c:s.confrontations[0]};
}

test('a full suspicion meter stops the player; freezing up gets them busted with no alarm',()=>{
 const s=solo();const {p}=stopped(s);
 const x=p.x;stepHeist(s,{p:{x:1,z:0,interact:false}},1/30);assert.equal(p.x,x,'a stopped player cannot walk away');
 for(let i=0;i<30*6&&s.phase==='playing';i++)stepHeist(s,{p:still},1/30);
 assert.equal(s.phase,'lost');assert.equal(s.busted,'P');assert.equal(s.alarms,0);
});

test('a guard can be bluffed twice, the second time with a narrower window, then busts you',()=>{
 const s=solo();const {g,c}=stopped(s);const first=c.width;
 const bluff=()=>{const cc=s.confrontations[0];while(Math.abs(talkNeedle(cc.t+1/30)-cc.center)>cc.width*.5)stepHeist(s,{p:still},1/30);stepHeist(s,{p:{...still,talk:true}},1/30);};
 bluff();
 assert.equal(s.phase,'playing');assert.equal(s.talkouts,1);assert.equal(s.alarms,0);assert.equal(g.mode,'patrol');assert.ok(g.wary);
 // Once he settles and looks again he stops the player again, with a much narrower window.
 const watch=()=>{for(let i=0;i<30*14&&s.phase==='playing'&&!s.confrontations.length;i++){g.x=-4;g.z=2.6;g.yaw=Math.PI/2;g.timer=5;stepHeist(s,{p:still},1/30);}};
 watch();assert.equal(s.confrontations.length,1);assert.ok(s.confrontations[0].width<first*0.6);
 bluff();assert.equal(s.talkouts,2);assert.equal(s.phase,'playing');
 watch();assert.equal(s.phase,'lost');assert.match(s.notice,/recognised/);
});

test('a badly timed bluff gets you busted, and a teammate can rescue you with a takedown',()=>{
 const s=solo();const {c}=stopped(s);
 while(Math.abs(talkNeedle(c.t+1/30)-c.center)<c.width*1.5)stepHeist(s,{p:still},1/30);
 stepHeist(s,{p:{...still,talk:true}},1/30);
 assert.equal(s.phase,'lost');assert.match(s.notice,/fumbled/);
 const duo=createHeistState('G','p',[{id:'p',name:'P'},{id:'q',name:'Q'}]);startHeist(duo);
 const g=duo.guards[0];for(const other of duo.guards.slice(1)){other.mode='stunned';other.timer=1e6;}
 const [p,q]=duo.players;g.x=-4;g.z=2.6;g.yaw=Math.PI/2;g.timer=60;p.x=0;p.z=2;q.x=-12;q.z=9;
 for(let i=0;i<30*8&&!duo.confrontations.length;i++)stepHeist(duo,{p:still,q:still},1/30);
 q.x=g.x-Math.sin(g.yaw)*1.1;q.z=g.z-Math.cos(g.yaw)*1.1;q.crouching=true;
 stepHeist(duo,{p:still,q:{...still,crouch:true,takedown:true}},1/30);stepHeist(duo,{p:still,q:{...still,crouch:true}},1/30);
 assert.equal(g.mode,'stunned');assert.equal(duo.confrontations.length,0);assert.equal(duo.phase,'playing');
});

test('crouching shortens sight range and walls block line of sight',()=>{
 const s=solo(),g=isolate(s),p=s.players[0];
 g.x=-4;g.z=2.6;g.yaw=Math.PI/2;p.x=2;p.z=2.6;
 assert.ok(guardVisibility(s,g,p)>0);
 p.crouching=true;assert.equal(guardVisibility(s,g,p),0);
 p.crouching=false;p.x=-4;p.z=6;g.yaw=0;
 assert.equal(guardVisibility(s,g,p),0,'the z=4 wall hides the deliveries room');
});

test('a takedown only works from behind, and the guard stays down',()=>{
 const s=solo(),g=isolate(s),p=s.players[0];
 g.x=-4;g.z=2.6;g.yaw=Math.PI/2;g.timer=10;p.crouching=true;
 p.x=-3;p.z=2.6;assert.equal(takedownTarget(s,p),null,'in front of the guard');
 p.x=-5;p.z=2.6;assert.equal(takedownTarget(s,p),g);
 stepHeist(s,{p:{...still,crouch:true,takedown:true}},1/30);
 assert.equal(g.mode,'stunned');assert.equal(s.takedowns,1);
 for(let i=0;i<30*5;i++)stepHeist(s,{p:{...still,crouch:true}},1/30);
 assert.equal(g.mode,'stunned');assert.ok(g.timer<GUARD_CONSTANTS.STUN_SECONDS);
});

test('sprinting is loud enough to draw a guard over',()=>{
 const s=solo(),g=isolate(s),p=s.players[0];
 g.x=-4;g.z=2.6;g.yaw=-Math.PI/2;g.timer=10;p.x=-1;p.z=0;
 for(let i=0;i<10;i++)stepHeist(s,{p:{x:1,z:0,interact:false,sprint:true}},1/30);
 assert.equal(g.mode,'suspicious');assert.ok(g.lastSeen);
});

test('the third alarm locks the building down, but explore mode never fails',()=>{
 for(const practice of [false,true]){
  const s=solo(),p=s.players[0];s.practice=practice;s.guards=[];
  const sector=MAPS[0].sectors.find(h=>!h.high)!;
  for(let i=0;i<30*60&&s.phase==='playing'&&s.alarms<4;i++){
   p.x=sector.x;p.z=sector.z;stepHeist(s,{p:still},1/30);
  }
  if(practice){assert.equal(s.phase,'playing');assert.ok(s.alarms>=3);}
  else{assert.equal(s.phase,'lost');assert.equal(s.alarms,3);}
 }
});

test('crouching slips under chest-height laser beams',()=>{
 const s=solo(),p=s.players[0];s.guards=[];
 const high=MAPS[0].sectors.find(h=>h.high)!;
 while(!sectorTiming(s,high).active)stepHeist(s,{p:{...still,crouch:true}},1/30);
 p.x=high.x;p.z=high.z;stepHeist(s,{p:{...still,crouch:true}},1/30);
 assert.equal(s.alarms,0);
});

test('movement has momentum and sprinting spends stamina',()=>{
 const s=solo(),p=s.players[0];s.guards=[];p.x=0;p.z=9;
 stepHeist(s,{p:{x:1,z:0,interact:false}},1/30);
 const first=p.vx;assert.ok(first>0&&first<HEIST_CONSTANTS.PLAYER_SPEED*.6,'accelerates instead of snapping');
 for(let i=0;i<15;i++)stepHeist(s,{p:{x:1,z:0,interact:false}},1/30);
 assert.ok(p.vx>HEIST_CONSTANTS.PLAYER_SPEED*.95);
 p.x=-14;
 for(let i=0;i<30*6;i++)stepHeist(s,{p:{x:i%60<30?1:-1,z:0,interact:false,sprint:true}},1/30);
 assert.ok(p.exhausted||p.stamina<.1,'six seconds of sprinting empties the reserve');
});

test('low cover hides a crouched player but not a standing one',()=>{
 const s=solo(),g=isolate(s),p=s.players[0];
 // Museum vitrine at (3.5, 1): guard to the west, player tucked in east of it.
 g.x=1.5;g.z=1;g.yaw=Math.PI/2;p.x=5;p.z=1;
 p.crouching=false;assert.ok(guardVisibility(s,g,p)>0,'standing shows over the vitrine');
 p.crouching=true;assert.equal(guardVisibility(s,g,p),0,'crouched behind the vitrine');
});

test('difficulty presets change sight, alarms and time, and only change in the lobby',()=>{
 const spotTime=(difficulty:'relaxed'|'standard'|'pro')=>{
  const s=createHeistState('D','p',[{id:'p',name:'P'}]);
  assert.ok(setHeistDifficulty(s,difficulty));startHeist(s);
  assert.equal(setHeistDifficulty(s,'relaxed'),false,'locked once the run starts');
  const g=isolate(s),p=s.players[0];g.x=-4;g.z=2.6;g.yaw=Math.PI/2;g.timer=60;p.x=1;p.z=2.6;
  let t=0;while(g.mode!=='confront'&&t<20){stepHeist(s,{p:still},1/30);t+=1/30;}
  return{t,alarms:s.maxAlarms,time:s.remaining};
 };
 const relaxed=spotTime('relaxed'),standard=spotTime('standard'),pro=spotTime('pro');
 assert.ok(relaxed.t>standard.t&&standard.t>pro.t,`spot times ${relaxed.t} > ${standard.t} > ${pro.t}`);
 assert.deepEqual([relaxed.alarms,standard.alarms,pro.alarms],[5,3,2]);
 assert.ok(relaxed.time>standard.time&&standard.time>pro.time);
});
