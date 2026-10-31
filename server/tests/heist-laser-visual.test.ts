import assert from 'node:assert/strict';
import test from 'node:test';
import {LaserGate,SecurityLaserSector} from '../../client/heist/laser-grid';
import * as THREE from 'three';
import {laserAt,MAPS} from '../../shared/heist';

test('laser visuals terminate at hardware and preserve the authoritative clear gap',()=>{
 for(let level=0;level<MAPS.length;level++)for(let index=0;index<MAPS[level].laserCount;index++){
  const gate=new LaserGate(index,level);
  for(const elapsed of [0,.6,1.4,2.8,3.8,7,11.7]){
   gate.update(elapsed);const laser=laserAt(elapsed,index,level);
   assert.equal(gate.root.position.z,laser.z);
   assert.equal(gate.receivers[0].position.x,laser.x-1.25);
   assert.equal(gate.receivers[1].position.x,laser.x+1.25);
   for(const [i,beam] of gate.beams.entries()){
    const start=beam.position.x-beam.scale.x/2,end=beam.position.x+beam.scale.x/2;
    const [expectedStart,expectedEnd]=i%2===0?[-7,laser.x-1.25]:[laser.x+1.25,7];
    assert.ok(Math.abs(start-expectedStart)<.0001);
    assert.ok(Math.abs(end-expectedEnd)<.0001);
    assert.equal(beam.visible,laser.active&&expectedEnd-expectedStart>.005);
   }
  }
 }
});

test('timed laser curtains connect to lenses and stay inside horizontal and vertical hazard bounds',()=>{
 for(const rect of [{id:'horizontal',x:4,z:-3,w:6,d:2},{id:'vertical',x:-5,z:2,w:2,d:7}]){
  const sector=new SecurityLaserSector(rect);sector.root.updateMatrixWorld(true);
  const contacts=sector.light.children.filter(o=>o instanceof THREE.Mesh&&o.geometry instanceof THREE.SphereGeometry);
  const beams=sector.light.children.filter((o):o is THREE.Mesh<THREE.CylinderGeometry>=>o instanceof THREE.Mesh&&o.geometry instanceof THREE.CylinderGeometry);
  assert.ok(beams.length>=8);
  for(const beam of beams){
   for(const end of [-1,1]){
    const point=beam.localToWorld(new THREE.Vector3(0,end*beam.geometry.parameters.height/2,0));
    assert.ok(contacts.some(c=>c.getWorldPosition(new THREE.Vector3()).distanceTo(point)<1e-6),'each beam ends at a lens contact');
    assert.ok(Math.abs(point.x-rect.x)<=rect.w/2+1e-6);
    assert.ok(Math.abs(point.z-rect.z)<=rect.d/2+1e-6);
   }
  }
  sector.update(false);assert.equal(sector.light.visible,false);
  sector.update(true);assert.equal(sector.light.visible,true);
 }
});
