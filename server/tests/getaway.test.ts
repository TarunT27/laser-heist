import assert from 'node:assert/strict';
import test from 'node:test';
import {createGetaway,stepGetaway,driveCar,roadAt,roadRoute,insideBlock,signedSpeed,type DriveInput} from '../../client/heist/getaway-sim';

const none:DriveInput={up:false,down:false,left:false,right:false,brake:false};
const cfg={top:30,grip:.9,stars:2};

test('the van accelerates to its top speed and steers',()=>{
 const car={x:roadAt(1),z:roadAt(8),yaw:Math.PI,vx:0,vz:0};
 driveCar(car,{...none,up:true},30,.9,1/60);assert.ok(signedSpeed(car)>0&&signedSpeed(car)<1);
 for(let i=0;i<60*8;i++)driveCar(car,{...none,up:true},30,.9,1/60);
 assert.ok(signedSpeed(car)>27,`speed ${signedSpeed(car)}`);
 const yaw=car.yaw;for(let i=0;i<30;i++)driveCar(car,{...none,up:true,left:true},30,.9,1/60);
 assert.ok(car.yaw>yaw+.3,'turns left');
});

test('crashing into a building stops the van and damages it',()=>{
 const s=createGetaway(cfg);s.cops=[];
 // Mid-block on a north-south street, swerving at speed into the building on the right.
 s.van.x=roadAt(1)+2;s.van.z=roadAt(4)+24;s.van.yaw=Math.PI/2;s.van.vx=20;
 for(let i=0;i<60*2;i++)stepGetaway(s,{...none,up:true},1/60);
 assert.ok(!insideBlock(s.van.x,s.van.z),'never inside a building');
 assert.ok(s.van.damage>0,'impact damage');
});

test('sitting still with a cruiser alongside gets you busted',()=>{
 const s=createGetaway(cfg);
 for(let i=0;i<60*12&&s.phase==='escape';i++)stepGetaway(s,none,1/60);
 assert.equal(s.phase,'busted');
});

test('staying out of sight loses the police, then the drop-off ends the job',()=>{
 const s=createGetaway(cfg);s.cops=[];s.nextSpawn=1e9;
 for(let i=0;i<60*(s.evadeNeeded+1);i++)stepGetaway(s,none,1/60);
 assert.equal(s.wanted,false);
 s.van.x=s.dropoff.x;s.van.z=s.dropoff.z+3;s.van.vx=0;s.van.vz=0;stepGetaway(s,none,1/60);
 assert.equal(s.phase,'won');
});

test('road routes run along the street grid to the target',()=>{
 const to={x:roadAt(6),z:roadAt(2)};const route=roadRoute({x:roadAt(1),z:roadAt(7)},to);
 assert.deepEqual(route.at(-1),to);
 for(const p of route)assert.ok(!insideBlock(p.x,p.z),'every waypoint is on a road');
});

test('police navigate the street grid to a van parked blocks away and arrest it',()=>{
 const s=createGetaway({top:30,grip:.9,stars:3});
 // Hiding would lose them first; this checks that they can find and arrest a stopped van.
 s.van.x=roadAt(4);s.van.z=roadAt(4);s.lastSeen={x:s.van.x,z:s.van.z};s.evadeNeeded=1e9;
 let t=0;for(;t<40&&s.phase==='escape';t+=1/60)stepGetaway(s,none,1/60);
 assert.equal(s.phase,'busted',`still escaping after ${t.toFixed(1)}s`);
});

test('the sim reports braking and the strength of each crash',()=>{
 const s=createGetaway(cfg);s.cops=[];
 s.van.x=roadAt(1)+2;s.van.z=roadAt(4)+24;s.van.yaw=Math.PI/2;s.van.vx=20;
 let hardest=0;for(let i=0;i<60;i++){stepGetaway(s,{...none,up:true},1/60);hardest=Math.max(hardest,s.impact);}
 assert.ok(hardest>15,`impact ${hardest}`);
 s.van.x=roadAt(1);s.van.z=roadAt(4)+20;s.van.yaw=0;s.van.vx=0;s.van.vz=15;
 stepGetaway(s,{...none,down:true},1/60);assert.equal(s.braking,true);
 stepGetaway(s,{...none,up:true},1/60);assert.equal(s.braking,false);
});
