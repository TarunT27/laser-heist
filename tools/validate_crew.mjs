import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const url=new URL('../public/heist/crew.glb',import.meta.url),bytes=await fs.readFile(url);
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
const root=gltf.scene,mixer=new THREE.AnimationMixer(root),meshes=[];
root.traverse(o=>{if(o.isMesh){meshes.push(o);for(const [name,attr] of Object.entries(o.geometry.attributes))for(const n of attr.array)if(!Number.isFinite(n))throw new Error(`Non-finite ${name} in ${o.name}`);}});
function bounds(){root.updateMatrixWorld(true);for(const m of meshes)if(m.isSkinnedMesh)m.skeleton.update();const b=new THREE.Box3();const v=new THREE.Vector3();for(const m of meshes)for(let i=0;i<m.geometry.attributes.position.count;i++){m.getVertexPosition(i,v);v.applyMatrix4(m.matrixWorld);b.expandByPoint(v);}return {min:b.min.toArray(),max:b.max.toArray(),height:b.max.y-b.min.y};}
const report={bytes:bytes.length,meshCount:meshes.length,clips:[]};
for(const name of ['Idle','Walk','Run','Crouch','CrouchIdle','Interact']){
 const c=gltf.animations.find(a=>a.name===name);if(!c)throw Error('Missing '+name);
 mixer.stopAllAction();const a=mixer.clipAction(c);a.reset().setEffectiveWeight(1).play();const samples=[];
 for(const f of [0,.25,.5,.75]){mixer.setTime(c.duration*f);samples.push(bounds());}
 const thigh=c.tracks.filter(t=>/thigh.*quaternion/i.test(t.name));let variation=0;
 for(const t of thigh){const values=t.values;const first=new THREE.Quaternion().fromArray(values,0).normalize();for(let i=4;i<values.length;i+=4){const q=new THREE.Quaternion().fromArray(values,i).normalize();variation=Math.max(variation,first.angleTo(q));}}
 if(['Walk','Run','Crouch'].includes(name)&&variation<.1)throw Error(name+' has no meaningful leg movement');
 report.clips.push({name,duration:c.duration,legVariation:variation,bounds:samples});
}
const idle=report.clips.find(c=>c.name==='Idle').bounds[0].max[1],crouch=report.clips.find(c=>c.name==='CrouchIdle').bounds[0].max[1];
if(idle-crouch<.35)throw Error('Crouch does not lower the character enough');
await fs.writeFile(new URL('../docs/laser/qa/character-validation.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify({bytes:report.bytes,meshes:report.meshCount,standingHeight:idle,crouchedHeight:crouch,clips:report.clips.map(c=>({name:c.name,seconds:c.duration,legVariation:c.legVariation}))},null,2));
