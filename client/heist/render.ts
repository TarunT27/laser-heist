import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { MAPS, ROLE_NAMES, gateOpen, sectorTiming, objectiveAvailable, visionReach, guardRange, GUARD_CONSTANTS, type HeistState, type HeistPlayer, type HeistGuard } from '../../shared/heist';
import { CameraFollow } from './camera-follow';
import { asset } from './asset';
import { SecurityLaserSector } from './laser-grid';

export const COLORS=['#e4b66a','#83c5bd','#bc9fe1','#db8e88'];
type GuardView={root:THREE.Group;body:THREE.Object3D;mixer:THREE.AnimationMixer|null;actions:Record<string,THREE.AnimationAction>;active:string;cone:THREE.Mesh;coneGeo:THREE.BufferGeometry;tag:HTMLElement;lamp?:THREE.SpotLight};
type Avatar={root:THREE.Object3D;mixer:THREE.AnimationMixer;actions:Record<string,THREE.AnimationAction>;aliases:Record<string,string>;mode:string;activeAction:string;velocity:THREE.Vector3;speed:number;loot:THREE.Object3D[];daypack:THREE.Object3D[]};
const mat=(color:string,roughness=.5,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
const themes=[{sky:'#161b26',floor:'#b9b0a0',tile:'#9f9584',wall:'#b8ae9c',trim:'#3a3128',metal:'#b69758',accent:'#ffb547'},{sky:'#121a1c',floor:'#2c2a27',tile:'#3b3631',wall:'#5a3d2b',trim:'#c49b49',metal:'#c49b49',accent:'#ffb547'},{sky:'#0b1322',floor:'#2b3a46',tile:'#3a4d5c',wall:'#425868',trim:'#6fd3ff',metal:'#628797',accent:'#6fd3ff'}];
/** Procedural floor tiles so rooms read as real surfaces instead of flat colour. */
function floorTexture(level:number){
 const t=themes[level],c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d')!;
 g.fillStyle=t.floor;g.fillRect(0,0,256,256);
 if(level===0){g.fillStyle=t.tile;g.fillRect(0,0,128,128);g.fillRect(128,128,128,128);g.strokeStyle='#00000018';g.lineWidth=2;g.strokeRect(1,1,254,254);g.strokeRect(1,1,126,126);g.strokeRect(129,129,126,126);}
 else if(level===1){for(let y=0;y<256;y+=32)for(let x=0;x<256;x+=64){g.fillStyle=((x+y)/32)%2?t.tile:t.floor;g.fillRect(x+((y/32)%2)*32,y,62,30);}g.fillStyle='#c49b4922';g.fillRect(0,126,256,4);}
 else{g.strokeStyle=t.tile;g.lineWidth=3;for(let i=0;i<=256;i+=32){g.beginPath();g.moveTo(i,0);g.lineTo(i,256);g.stroke();g.beginPath();g.moveTo(0,i);g.lineTo(256,i);g.stroke();}g.fillStyle='#6fd3ff18';for(let i=16;i<256;i+=64)g.fillRect(0,i,256,2);}
 const tex=new THREE.CanvasTexture(c);tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;return tex;
}
export class MuseumView {
 scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.12,220);renderer:THREE.WebGLRenderer;
 pitch=.32;distance=4.8;locked=false;sensitivity=.0024;ready=false;overview=false;level=-1;loadingMap=false;fps=60;
 private cameraFollow=new CameraFollow();
 get yaw(){return this.cameraFollow.yaw;}
 private composer:EffectComposer;private envs=new Map<number,THREE.Object3D>();private world=new THREE.Group();private mechanics=new THREE.Group();private template?:THREE.Object3D;private animations:THREE.AnimationClip[]=[];private avatars=new Map<string,Avatar>();private guardViews=new Map<string,GuardView>();private labels=new Map<string,HTMLElement>();private targets=new Map<string,HTMLElement>();
 private proc=new THREE.Group();private hd=new Map<number,THREE.Object3D>();private hdGates=new Map<string,THREE.Object3D>();private loader=new GLTFLoader();private door=new THREE.Group();private vent=new THREE.Group();private service=new THREE.Group();private gem=new THREE.Group();private lasers:SecurityLaserSector[]=[];private consoles:THREE.Mesh[]=[];private helicopter?:THREE.Object3D;private rotor?:THREE.Object3D;private tailRotor?:THREE.Object3D;private cones:THREE.Mesh[]=[];private spotCircle?:THREE.Mesh;
 private cameraBlockers:THREE.Object3D[]=[];private ray=new THREE.Raycaster();private look=new THREE.Vector3();private lastTime=0;private pointerDown:{x:number;y:number}|null=null;private transition=0;
 constructor(public canvas:HTMLCanvasElement,private labelRoot:HTMLElement,private markerRoot:HTMLElement){
  this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));this.renderer.setSize(innerWidth,innerHeight);
  this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.82;
  this.scene.background=new THREE.Color(themes[0].sky);this.scene.fog=new THREE.Fog(themes[0].sky,60,170);
  const pm=new THREE.PMREMGenerator(this.renderer),room=new RoomEnvironment();this.scene.environment=pm.fromScene(room,.035).texture;this.scene.environmentIntensity=.22;room.dispose();pm.dispose();
  this.scene.add(new THREE.HemisphereLight('#aebfe8','#1e1a17',.55));
  const sun=new THREE.DirectionalLight('#9fb4e8',1.25);sun.position.set(-18,24,-16);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-23,right:23,top:23,bottom:-23,near:.5,far:85});sun.shadow.bias=-.0003;sun.shadow.normalBias=.035;this.scene.add(sun);
  const blue=new THREE.DirectionalLight('#a9cadb',.5);blue.position.set(12,10,15);this.scene.add(blue);
  this.composer=new EffectComposer(this.renderer);this.composer.addPass(new RenderPass(this.scene,this.camera));this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.22,.3,1.4));this.composer.addPass(new OutputPass());
  this.scene.add(this.world,this.mechanics);this.city();
  for(const x of [-8,8])for(const z of [-7,0,7]){const l=new THREE.PointLight('#ffe0b5',6,9,2);l.position.set(x,4.4,z);this.scene.add(l);}
  canvas.addEventListener('contextmenu',e=>e.preventDefault());canvas.addEventListener('pointerdown',e=>{if(this.locked)return;if(e.button===2||e.pointerType==='touch'){this.pointerDown={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}});
  canvas.addEventListener('pointermove',e=>{if(!this.pointerDown||this.locked)return;this.cameraFollow.orbit(e.clientX-this.pointerDown.x,performance.now());this.pitch=THREE.MathUtils.clamp(this.pitch+(e.clientY-this.pointerDown.y)*.004,-.16,.85);this.pointerDown={x:e.clientX,y:e.clientY};this.overview=false;});
  // Pointer lock: the mouse owns the camera, like any third-person game.
  document.addEventListener('pointerlockchange',()=>{this.locked=document.pointerLockElement===canvas;if(this.locked)this.cameraFollow.auto=false;});
  document.addEventListener('mousemove',e=>{if(!this.locked)return;this.cameraFollow.orbit(e.movementX,performance.now(),this.sensitivity);this.pitch=THREE.MathUtils.clamp(this.pitch+e.movementY*this.sensitivity*.9,-.15,1.0);this.overview=false;});
  canvas.addEventListener('pointerup',()=>this.pointerDown=null);canvas.addEventListener('pointercancel',()=>this.pointerDown=null);
  canvas.addEventListener('wheel',e=>{e.preventDefault();this.distance=THREE.MathUtils.clamp(this.distance+e.deltaY*.004,2.4,7.5);},{passive:false});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();document.dispatchEvent(new CustomEvent('heist-render-error',{detail:'Graphics paused. Reload to reconnect.'}));});
  window.addEventListener('resize',()=>this.resize());this.resize();
 }
 async load(progress:(m:string)=>void){
  const loader=new GLTFLoader();progress('Fitting out the crew…');
  const crew=await loader.loadAsync(asset('heist/crew.glb?v=20261030-props'));this.template=crew.scene;this.animations=crew.animations;
  progress('Preparing all three contracts…');
  for(const map of MAPS)this.envs.set(map.id,new THREE.Group());
  await this.setLevel(0);progress('Building the museum…');await this.loadHD(0);this.ready=true;
  // The other two contracts stream in behind the menu.
  void this.loadHD(1).then(()=>this.loadHD(2));
  progress('Preparing the extraction aircraft…');
  const heli=await loader.loadAsync(asset('heist/helicopter.glb?v=20261030-props'));this.helicopter=heli.scene;this.helicopter.position.set(-11,3.5,-14.5);this.helicopter.rotation.y=.48;
  this.helicopter.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
  this.scene.add(this.helicopter);this.rotor=this.helicopter.getObjectByName('MainRotor');this.tailRotor=this.helicopter.getObjectByName('TailRotor');
 }
 async setLevel(level:number){
  if(this.level===level||this.loadingMap)return;
  const environment=this.envs.get(level);if(!environment)return;
  this.loadingMap=true;
  try{
   this.makeMechanics(level);this.world.clear();this.world.add(environment);this.level=level;this.applyHD();
   const theme=themes[level];this.scene.background=new THREE.Color(theme.sky);if(this.scene.fog instanceof THREE.Fog)this.scene.fog.color.set(theme.sky);
   this.level=level;
  }finally{this.loadingMap=false;}
 }
 private box(size:number[],pos:number[],material:THREE.Material,parent:THREE.Object3D=this.mechanics){const m=new THREE.Mesh(new THREE.BoxGeometry(...size as [number,number,number]),material);m.position.set(...pos as [number,number,number]);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
 private makeMechanics(level:number){
  this.mechanics.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose();});this.mechanics.clear();this.cameraBlockers=[];this.lasers=[];this.gem=new THREE.Group();
  const m=MAPS[level],theme=themes[level],stone=mat(theme.floor,.65),metal=mat(theme.metal,.3,.7),dark=mat('#23343c'),glow=mat(theme.accent);
  // Placeholder blocks live in `proc`; they are hidden once the Blender world for this level loads.
  this.proc=new THREE.Group();this.proc.name='procedural';this.mechanics.add(this.proc);const proc=this.proc;
  const tex=floorTexture(level);
  for(const f of m.floors){const t=tex.clone();t.needsUpdate=true;t.repeat.set(f.w/2,f.d/2);const floor=this.box([f.w,.25,f.d],[f.x,-.15,f.z],new THREE.MeshStandardMaterial({map:t,roughness:level===0?.35:.6,metalness:level===2?.4:.05}),proc);floor.castShadow=false;}
  for(const r of m.rooms){
   const canvas=document.createElement('canvas');canvas.width=512;canvas.height=64;const c=canvas.getContext('2d')!;c.fillStyle='#18333d';c.fillRect(0,0,512,64);c.fillStyle=theme.accent;c.font='bold 26px sans-serif';c.textAlign='center';c.fillText(r.label,256,42);
   const sign=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(r.w-1,5),.6),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),side:THREE.DoubleSide}));sign.rotation.x=-Math.PI/2;sign.position.set(r.x,.03,r.z+r.d/2-.6);this.mechanics.add(sign);
  }
  // Keep exterior shells outside playable bounds; low internal walls preserve sightlines.
  if(level<2){for(const side of [-1,1]){this.box([.2,1.1,24],[side*16,.55,0],stone,proc);this.box([32,1.1,.2],[0,.55,side*12],stone,proc);}}

  // Solid 2.6 m walls: tall enough to hide behind, low enough that the raised camera sees over them.
  const wallMat=mat(theme.wall,.8),trimMat=mat(theme.trim,.45,.3);
  for(const w of m.walls){const tall=w.kind==='cover'?w.height:Math.max(2.6,w.height);const mesh=this.box([w.w,tall,w.d],[w.x,tall/2,w.z],wallMat.clone(),proc);this.cameraBlockers.push(mesh);this.box([w.w+.04,.18,w.d+.04],[w.x,.09,w.z],trimMat,proc);this.box([w.w+.08,.06,w.d+.08],[w.x,tall+.03,w.z],metal,proc);}
  // Low perimeter rails show the exact walkable floor union, including roof gaps.
  const inside=(x:number,z:number)=>m.floors.some(f=>Math.abs(x-f.x)<f.w/2-.01&&Math.abs(z-f.z)<f.d/2-.01);
  for(const f of m.floors){for(const side of [-1,1]){
   for(let x=f.x-f.w/2;x<f.x+f.w/2;x+=.5)if(!inside(x+.25,f.z+side*(f.d/2+.1)))this.box([.5,.45,.1],[x+.25,.2,f.z+side*f.d/2],metal,proc);
   for(let z=f.z-f.d/2;z<f.z+f.d/2;z+=.5)if(!inside(f.x+side*(f.w/2+.1),z+.25))this.box([.1,.45,.5],[f.x+side*f.w/2,.2,z+.25],metal,proc);
  }}
  for(const gate of m.gates){const mesh=this.box([gate.w,gate.crawl?1.15:2.3,gate.d],[gate.x,gate.crawl?.575:1.15,gate.z],metal.clone(),proc);mesh.name='gate:'+gate.id;this.cameraBlockers.push(mesh);}
  if(level===1)this.box([3,.4,.5],[0,1.5,0],metal,proc);
  for(const o of m.objectives){
   if(o.kind==='loot')continue;
   const base=this.box([.5,.8,.5],[o.x,.4,o.z],dark,proc);base.name='console:'+o.id;
   const light=this.box([.55,.08,.4],[o.x,.85,o.z],new THREE.MeshStandardMaterial({color:theme.accent,emissive:theme.accent,emissiveIntensity:1}));light.name='light:'+o.id;
   if(o.kind==='hold'){const cl=this.box([.8,.16,.15],[o.x,1,o.z],metal);cl.name='clamp:'+o.id;cl.visible=false;}
  }
  for(const sector of m.sectors){const mesh=this.box([sector.w,.04,sector.d],[sector.x,.04,sector.z],new THREE.MeshBasicMaterial({color:'#ff6655',transparent:true,opacity:.5}));mesh.name='hazard:'+sector.id;
   if(level<2){const laser=new SecurityLaserSector(sector,!!sector.high);this.lasers.push(laser);this.mechanics.add(laser.root);}
   else {const cone=new THREE.Mesh(new THREE.ConeGeometry(1.2,5,24,1,true),new THREE.MeshBasicMaterial({color:'#fff3c5',transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide}));cone.position.set(sector.x,2.5,sector.z);cone.name='beam:'+sector.id;this.mechanics.add(cone);}

  }
  // Cargo is rendered at its authoritative recoverable position, including when braked.
  if(m.cargo==='cart'){
   this.box([1.1,.2,1.5],[0,.35,0],metal,this.gem);this.box([.8,.55,1.1],[0,.7,0],mat('#e4b654',.3,.8),this.gem);
   for(const x of [-.5,.5])for(const z of [-.5,.5]){const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.18,.18,.12,12),dark);wheel.rotation.z=Math.PI/2;wheel.position.set(x,.2,z);this.gem.add(wheel);}
  }else {this.box([.65,.5,.45],[0,.65,0],m.cargo==='core'?glow:dark,this.gem);this.box([.45,.08,.3],[0,.93,0],metal,this.gem);}
  this.mechanics.add(this.gem);
  // Extraction ring and escape-route dashes belong to the finale; setups hide them.
  const finale=new THREE.Group();finale.name='finale-markings';this.mechanics.add(finale);
  const ring=new THREE.Mesh(new THREE.RingGeometry(2.8,3,64),new THREE.MeshBasicMaterial({color:theme.accent,side:THREE.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(m.exit.x,.03,m.exit.z);finale.add(ring);
  for(let i=1;i<m.escape.length;i++){const a=m.escape[i-1],b=m.escape[i],len=Math.hypot(b.x-a.x,b.z-a.z);for(let d=0;d<len;d+=1){const marker=this.box([.18,.03,.5],[a.x+(b.x-a.x)*d/len,.02,a.z+(b.z-a.z)*d/len],glow,finale);marker.rotation.y=Math.atan2(b.x-a.x,b.z-a.z);}}
  if(level===1){this.box([2.1,1.7,3.4],[14,1,9],dark,proc);this.box([2,.5,.9],[14,1.7,7.8],glow,proc);}
  
  if(level===2)for(const x of [-3,4]){const cover=this.box([1.4,1.3,.15],[x,.65,-8.3],metal);cover.name='screen:'+x;}
 }
 private city(){
  const geo=new THREE.BoxGeometry(1,1,1),buildings=new THREE.InstancedMesh(geo,mat('#596675',.85),110),windows=new THREE.InstancedMesh(geo,new THREE.MeshBasicMaterial({color:'#e7bd84'}),2200);let seed=745;const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296};const dummy=new THREE.Object3D();let wi=0;
  for(let i=0;i<110;i++){const a=rnd()*Math.PI*2,r=40+rnd()*80,x=Math.sin(a)*r,z=Math.cos(a)*r,w=3+rnd()*6,h=8+rnd()*30;dummy.position.set(x,h/2-22,z);dummy.scale.set(w,h,w);dummy.updateMatrix();buildings.setMatrixAt(i,dummy.matrix);buildings.setColorAt(i,new THREE.Color().setHSL(.57,.10,.24+rnd()*.13));
   for(let j=0;j<20;j++){dummy.position.set(x+(rnd()-.5)*(w-.5),-20+rnd()*(h-2),z+w/2+.02);dummy.scale.set(.18+rnd()*.3,.35,.03);dummy.updateMatrix();windows.setMatrixAt(wi++,dummy.matrix);}
  }windows.count=wi;this.scene.add(buildings,windows);
  const water=new THREE.Mesh(new THREE.PlaneGeometry(400,400),mat('#4d7280',.3,.4));water.rotation.x=-Math.PI/2;water.position.y=-23;this.scene.add(water);
 }
 resize(){this.camera.aspect=innerWidth/innerHeight;this.camera.updateProjectionMatrix();this.renderer.setSize(innerWidth,innerHeight);this.composer.setSize(innerWidth,innerHeight);}
 movement(x:number,y:number){return this.cameraFollow.movement(x,y);}
 resetMovement(){this.cameraFollow.resetMovement();}
 resetCamera(){this.cameraFollow.reset();this.pitch=.32;this.distance=4.8;this.overview=false;}
 /** Load the Blender-built environment for a contract (public/heist/hd-world-N.glb, from tools/build_heist_hd.py). */
 async loadHD(level:number){
  if(this.hd.has(level))return;
  try{
   const gltf=await this.loader.loadAsync(asset(`heist/hd-world-${level}.glb?v=20261031-vault`));
   gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){o.receiveShadow=true;o.castShadow=!/^Floor/.test(o.name)&&!/^Floor/.test(o.parent?.name??'');for(const m of Array.isArray(o.material)?o.material:[o.material])if(m instanceof THREE.MeshStandardMaterial&&m.map)m.map.anisotropy=8;}});
   this.hd.set(level,gltf.scene);
   if(this.level===level)this.applyHD();
  }catch(error){console.warn('HD environment unavailable; using blockout geometry',error);}
 }
 private applyHD(){
  const scene=this.hd.get(this.level);this.hdGates.clear();
  if(!scene){this.proc.visible=true;return;}
  const env=this.envs.get(this.level)!;env.clear();env.add(scene);
  this.proc.visible=false;
  // Fade the real walls instead of the hidden blockout when they come between camera and player.
  this.cameraBlockers=[];
  scene.traverse(o=>{
   const root=(()=>{let found:THREE.Object3D|null=null;for(let n:THREE.Object3D|null=o;n&&n!==scene;n=n.parent)if(/^(Wall_|Gate_)/.test(n.name))found=n;return found;})();
   if(o.name.startsWith('Gate_')&&root===o)this.hdGates.set(o.name.slice(5),o);
   if(root&&o instanceof THREE.Mesh){o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();this.cameraBlockers.push(o);}
  });
  for(const o of this.mechanics.children)if(o.name.startsWith('light:')||o.name.startsWith('clamp:'))o.position.y=o.name.startsWith('light:')?1.12:1.22;
 }
 lockPointer(){if(!this.locked&&matchMedia('(pointer:fine)').matches)void this.canvas.requestPointerLock?.()?.catch?.(()=>{});}
 unlockPointer(){if(this.locked)document.exitPointerLock();}
 private spawnAvatar(p:HeistPlayer){
  const root=clone(this.template!);
  root.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;const original=Array.isArray(o.material)?o.material:[o.material];const replaced=original.map(m=>{const c=m.clone();if(c instanceof THREE.MeshStandardMaterial){const materialName=c.name.toLowerCase();if(materialName.includes('accent'))c.color.set(COLORS[p.color%4]);if(/^skin(?:[._-]\d+)?$/.test(materialName))c.color.set(['#bd8564','#82563e','#d6a181','#ab7154'][p.color%4]);c.needsUpdate=true;}return c});o.material=Array.isArray(o.material)?replaced:replaced[0];}});
  const gear=new THREE.Group();gear.name='role-equipment';root.add(gear);
  const equipment=(role:string,size:number[],pos:number[])=>{const mesh=this.box(size,pos,mat('#172c37',.4,.5),gear);mesh.name='role:'+role;};
  equipment('hacker',[.18,.24,.1],[.36,1.05,.1]);equipment('hacker',[.035,.4,.035],[.25,1.65,-.12]);
  equipment('infiltrator',[.18,.09,.13],[0,1.73,.23]);equipment('infiltrator',[.5,.12,.13],[0,.9,.15]);
  equipment('carrier',[.52,.65,.25],[0,1.15,-.25]);equipment('carrier',[.5,.5,.06],[0,1.15,-.41]);
  equipment('lookout',[.25,.13,.18],[.27,1.5,.06]);equipment('lookout',[.3,.12,.15],[0,1.3,.24]);
  root.updateMatrixWorld(true);
  for(const part of [...gear.children]){const boneName=part.position.y>1.65?'Head':part.name==='role:hacker'&&part.position.y<1.2?'lowerarm_l':'spine_03';const bone=root.getObjectByName(boneName);if(bone)bone.attach(part);}
  this.scene.add(root);root.position.set(p.x,0,p.z);
  const mixer=new THREE.AnimationMixer(root),actions:Record<string,THREE.AnimationAction>={};
  const kinds=['CrouchIdle','Interact','Carry','Crouch','Walk','Run','Idle'];
  const compact=(name:string)=>name.replace(/(?:[._-]\d+)+$/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  for(const clip of this.animations){const token=compact(clip.name);const name=kinds.find(kind=>token===compact(kind)||token.endsWith(compact(kind))||token.startsWith(compact(kind)));if(name&&!actions[name]){const action=mixer.clipAction(clip);action.setLoop(THREE.LoopRepeat,Infinity);action.clampWhenFinished=false;action.setEffectiveWeight(0);action.setEffectiveTimeScale(1);action.play();actions[name]=action;}}
  const pick=(...names:string[])=>names.find(name=>actions[name])||'';
  const aliases:Record<string,string>={
   Idle:pick('Idle','Walk','Run','Carry','CrouchIdle','Crouch'),
   Walk:pick('Walk','Run','Idle','Carry'),
   Run:pick('Run','Walk','Idle'),
   Crouch:pick('Crouch','CrouchIdle','Walk','Idle'),
   CrouchIdle:pick('CrouchIdle','Crouch','Idle','Carry'),
   Interact:pick('Interact','Idle','Carry','Walk'),
   Carry:pick('Carry','Idle','Walk'),
  };
  const activeAction=aliases.Idle||Object.keys(actions)[0]||'';if(activeAction)actions[activeAction].setEffectiveWeight(1);
  const loot:THREE.Object3D[]=[],daypack:THREE.Object3D[]=[];
  root.traverse(o=>{if(o.name.startsWith('Loot_')){loot.push(o);o.visible=false;}else if(/^(Slim_technical_backpack|Backpack_|Pack_zipper)/.test(o.name))daypack.push(o);});
  const avatar={root,mixer,actions,aliases,mode:'Idle',activeAction,velocity:new THREE.Vector3(),speed:0,loot,daypack};this.avatars.set(p.id,avatar);const label=document.createElement('span');label.className='player-tag';label.textContent=p.name;this.labelRoot.append(label);this.labels.set(p.id,label);return avatar;}
 draw(state:HeistState,localId:string,time:number,menu:boolean){
  const dt=Math.min(.05,(time-this.lastTime)/1000)||.016;this.lastTime=time;this.fps=THREE.MathUtils.lerp(this.fps,1/dt,.03);
  if(this.level!==state.level&&!this.loadingMap)void this.setLevel(state.level).catch(()=>document.dispatchEvent(new CustomEvent('heist-render-error',{detail:'This contract could not load. Reload the museum.'})));
  for(const p of state.players){if(!this.template)break;const a=this.avatars.get(p.id)||this.spawnAvatar(p);const next=new THREE.Vector3(p.x,0,p.z),previous=a.root.position.clone();
   a.root.position.lerp(next,1-Math.exp(-(p.id===localId?32:16)*dt));const renderedDelta=a.root.position.clone().sub(previous);a.velocity.lerp(renderedDelta.multiplyScalar(1/Math.max(dt,.0001)),1-Math.exp(-18*dt));a.speed=THREE.MathUtils.clamp(a.velocity.length(),0,8);if(a.speed>.12){const heading=Math.atan2(a.velocity.x,a.velocity.z);const difference=THREE.MathUtils.euclideanModulo(heading-a.root.rotation.y+Math.PI,Math.PI*2)-Math.PI;a.root.rotation.y+=difference*Math.min(1,dt*14);}else if(p.id===localId&&!menu){const desired=this.yaw+Math.PI;const difference=THREE.MathUtils.euclideanModulo(desired-a.root.rotation.y+Math.PI,Math.PI*2)-Math.PI;a.root.rotation.y+=difference*Math.min(1,dt*6);}
   a.root.traverse(o=>{if(o.name.startsWith('role:'))o.visible=o.name==='role:'+p.role;});this.labels.get(p.id)!.textContent=({hacker:'⌘',infiltrator:'◇',carrier:'▣',lookout:'◎'}[p.role])+' '+p.name;
   a.root.visible=p.connected;const runEnter=4.15,runExit=3.55,moveEnter=.18,moveExit=.08;let anim:string;if(p.crouching)anim=a.speed>(a.mode==='Crouch'?moveExit:moveEnter)?'Crouch':'CrouchIdle';else if(a.mode==='Run'&&a.speed>runExit)anim='Run';else if(a.speed>runEnter)anim='Run';else if(a.mode==='Walk'&&a.speed>moveExit&&a.speed<runEnter)anim='Walk';else if(a.speed>moveEnter)anim='Walk';else if(p.interacting)anim='Interact';else if(p.carrying)anim='Carry';else anim='Idle';const targetName=a.aliases[anim]||a.activeAction;if(targetName&&targetName!==a.activeAction){const from=a.actions[a.activeAction],to=a.actions[targetName];if(to){to.reset();to.setEffectiveWeight(1);to.play();if(from&&from!==to)to.crossFadeFrom(from,.16,false);a.activeAction=targetName;}}
   const active=a.actions[a.activeAction];if(active){const nominal=a.activeAction==='Run'?5:a.activeAction==='Walk'?3.2:a.activeAction==='Crouch'?1.5:1;const idleMode=anim==='Idle'||anim==='CrouchIdle'||anim==='Carry'||anim==='Interact';const crouchIdleFallback=anim==='CrouchIdle'&&!a.actions.CrouchIdle;active.setEffectiveTimeScale(idleMode?(crouchIdleFallback?.1:1):THREE.MathUtils.clamp(a.speed/nominal,.65,1.35));}a.mode=anim;a.mixer.update(dt);for(const part of a.loot)part.visible=p.carrying&&MAPS[state.level].cargo!=='cart';for(const part of a.daypack)part.visible=!p.carrying;this.positionLabel(this.labels.get(p.id)!,a.root.position.clone().add(new THREE.Vector3(0,p.crouching?1.5:2.1,0)),p.id!==localId&&p.connected&&!menu);
  }
  for(const[id,a]of this.avatars)if(!state.players.some(p=>p.id===id)){this.scene.remove(a.root);this.labels.get(id)?.remove();this.labels.delete(id);this.avatars.delete(id);}
  this.drawGuards(state,dt,time,menu);
  const me=this.avatars.get(localId);if(menu||!me||this.overview){const angle=time*.00007;const cinema=menu&&state.phase==='lobby';const orbit=time*.00004;const destination=cinema?new THREE.Vector3(Math.sin(orbit)*24,15,Math.cos(orbit)*24):new THREE.Vector3(23,22,31);this.camera.position.lerp(destination,Math.min(1,dt*3));this.look.lerp(cinema?new THREE.Vector3(-4,0,0):new THREE.Vector3(0,1,0),Math.min(1,dt*3));}
  // Follow behind the model heading; CameraFollow keeps held input independent of this turn.
  else this.cameraFollow.follow(me.root.rotation.y,me.speed,dt,time);
  if(me&&!menu&&!this.overview){const p=state.players.find(p=>p.id===localId)!;const shoulder=new THREE.Vector3(Math.cos(this.yaw)*.42,0,-Math.sin(this.yaw)*.42);const eye=me.root.position.clone().add(new THREE.Vector3(0,p.crouching?.85:1.35,0)).add(shoulder);const height=.9+Math.sin(this.pitch)*this.distance;const reach=Math.cos(this.pitch*.6)*this.distance;const desired=eye.clone().add(new THREE.Vector3(Math.sin(this.yaw)*reach,height,Math.cos(this.yaw)*reach));if(this.level<2){desired.x=THREE.MathUtils.clamp(desired.x,-15.5,15.5);desired.z=THREE.MathUtils.clamp(desired.z,-11.5,11.5);}const fov=me.speed>4.3?62:55;if(Math.abs(this.camera.fov-fov)>.05){this.camera.fov=THREE.MathUtils.lerp(this.camera.fov,fov,1-Math.exp(-5*dt));this.camera.updateProjectionMatrix();}const vec=desired.clone().sub(eye);this.ray.set(eye,vec.clone().normalize());this.ray.far=vec.length();// Walls between the camera and the player fade out instead of yanking the camera in.
const occluders=new Set(this.ray.intersectObjects(this.cameraBlockers.filter(o=>o.visible),false).map(h=>h.object));for(const b of this.cameraBlockers){const want=occluders.has(b)?.18:1;const list=(b as THREE.Mesh).material;for(const m of (Array.isArray(list)?list:[list]) as THREE.MeshStandardMaterial[]){if(m.userData.baseOpacity===undefined)m.userData.baseOpacity=m.opacity;const target=want*m.userData.baseOpacity;if(Math.abs(m.opacity-target)<.002)continue;m.opacity=THREE.MathUtils.lerp(m.opacity,target,1-Math.exp(-10*dt));m.transparent=m.opacity<.98;m.depthWrite=!m.transparent;m.needsUpdate=m.transparent!==m.userData.wasTransparent;m.userData.wasTransparent=m.transparent;}}this.camera.position.lerp(desired,1-Math.exp(-9*dt));this.look.lerp(eye.clone().add(new THREE.Vector3(-Math.sin(this.yaw)*1.5,0,-Math.cos(this.yaw)*1.5)),1-Math.exp(-12*dt));}
  this.camera.lookAt(this.look);
  // Tight spaces temporarily use a clear close camera, with no head filling the view.
  if(me&&!menu&&!this.overview){const p=state.players.find(p=>p.id===localId)!;const eye=me.root.position.clone().add(new THREE.Vector3(0,p.crouching?.85:1.35,0));me.root.visible=p.connected&&this.camera.position.distanceTo(eye)>1.7;}

  const map=MAPS[state.level];
  for(const g of map.gates){const open=gateOpen(state,g,{crouching:true} as HeistPlayer);const mesh=this.mechanics.getObjectByName('gate:'+g.id);if(mesh)mesh.visible=!open;const leaf=this.hdGates.get(g.id);if(!leaf)continue;
   // Hinged leaves (the bank vault door) swing: the bolts draw back for a beat, then the door eases round. Other leaves vanish.
   const swing=leaf.userData.swing as number|undefined;if(!swing){leaf.visible=!open;continue;}
   const t=leaf.userData.t=open?Math.min(1,(leaf.userData.t??0)+dt/3.6):0,u=THREE.MathUtils.clamp((t-.18)/.82,0,1);leaf.rotation.y=swing*u*u*(3-2*u);}
  const crewRoles=new Set(state.players.filter(p=>p.connected).map(p=>p.role));
  for(const o of map.objectives){const light=this.mechanics.getObjectByName('light:'+o.id) as THREE.Mesh;const done=state.completed.includes(o.id),cl=state.clamps[o.id],nobody=o.kind==='assist'&&!crewRoles.has(o.role!);if(light)(light.material as THREE.MeshStandardMaterial).color.set(done?'#8af0ad':cl?.installed?'#6ce7ff':!nobody&&objectiveAvailable(state,o)?'#f4d28e':'#52606b');const clamp=this.mechanics.getObjectByName('clamp:'+o.id);if(clamp)clamp.visible=!!cl?.installed;}
  for(const laser of this.lasers){const sector=map.sectors.find(h=>'laser-sector:'+h.id===laser.root.name);if(sector)laser.update(sectorTiming(state,sector).active);}
  for(const h of map.sectors){const mesh=this.mechanics.getObjectByName('hazard:'+h.id) as THREE.Mesh;if(mesh){const timing=sectorTiming(state,h);const beam=this.mechanics.getObjectByName('beam:'+h.id);if(beam)beam.visible=timing.active;(mesh.material as THREE.MeshBasicMaterial).color.set(timing.active?'#ff6655':'#65cba5');(mesh.material as THREE.MeshBasicMaterial).opacity=timing.active?.6:.1;}}
  this.gem.position.set(state.cargo.x,state.cargo.controller&&map.cargo!=='cart'?.4:0,state.cargo.z);this.gem.visible=map.cargo==='cart'||!state.cargo.controller;
  for(const x of [-3,4]){const screen=this.mechanics.getObjectByName('screen:'+x);if(screen)screen.visible=state.completed.includes('screens');}
  if(this.rotor)this.rotor.rotation.y=time*.024;if(this.tailRotor)this.tailRotor.rotation.x=time*.042;
  if(this.helicopter){this.helicopter.visible=state.level===2;this.helicopter.position.set(map.exit.x,3.5+Math.sin(time*.001)*.08,map.exit.z-3);}
  this.updateMarkers(state,localId,menu);this.composer.render();
 }
 private positionLabel(el:HTMLElement,point:THREE.Vector3,show:boolean){const p=point.project(this.camera);el.hidden=!show||p.z>1||p.z<0||Math.abs(p.x)>1.05||Math.abs(p.y)>1.05;if(!el.hidden)el.style.transform=`translate(${(p.x+1)*innerWidth/2}px,${(1-p.y)*innerHeight/2}px)`;}
 private updateMarkers(state:HeistState,id:string,menu:boolean){
  const m=MAPS[state.level],me=state.players.find(p=>p.id===id);
  for(const el of this.targets.values())el.hidden=true;
  const setup=state.mission?.kind==='setup'?state.mission:null;
  const finale=this.mechanics.getObjectByName('finale-markings');if(finale)finale.visible=!setup;
  const goals=setup?[...setup.targets.filter(t=>!t.done).map(t=>({id:'setup:'+t.id,label:t.label,x:t.x,z:t.z})),...(setup.targets.every(t=>t.done)?[{id:'setup-exit',label:'EXIT',...setup.exit}]:[])]:null;
  const scans=m.sectors.map(h=>{const t=sectorTiming(state,h);return{id:h.id,label:t.cut?'CUT':`${t.active?'SCAN':'SAFE'} ${Math.ceil(t.remaining)}s`,x:h.x,z:h.z,range:10,mine:false}});
  // Crew jobs: your own reads from across the map; a teammate's only up close, and nobody's job is hidden.
  const crew=new Set(state.players.filter(p=>p.connected).map(p=>p.role));
  const jobLabel=(o:typeof m.objectives[number])=>o.kind!=='assist'?o.label+(state.clamps[o.id]?.installed?' / CLAMPED':''):o.role===me?.role?`YOUR JOB · ${o.label}`:`${ROLE_NAMES[o.role!].toUpperCase()} · ${o.label}`;
  const points=goals?[...goals.map(g=>({...g,range:40,mine:false})),...scans]:[...m.objectives.filter(o=>!state.completed.includes(o.id)&&!(o.release&&state.completed.includes(o.release))&&objectiveAvailable(state,o)&&(o.kind!=='assist'||crew.has(o.role!))).map(o=>({id:o.id,label:jobLabel(o),x:o.x,z:o.z,range:o.kind==='assist'&&o.role===me?.role?40:10,mine:o.kind==='assist'&&o.role===me?.role})),{id:'extract',label:'EXTRACTION',...m.exit,range:10,mine:false},...scans];
  for(const p of points){let el=this.targets.get(p.id);if(!el){el=document.createElement('div');el.className='world-marker';this.markerRoot.append(el);this.targets.set(p.id,el);}el.textContent=p.label;el.classList.toggle('mine',p.mine);this.positionLabel(el,new THREE.Vector3(p.x,1.6,p.z),!menu&&state.phase==='playing'&&!!me&&Math.hypot(me.x-p.x,me.z-p.z)<p.range);}
 }
 private spawnGuardView(g:HeistGuard):GuardView{
  const root=new THREE.Group();root.name='guard:'+g.id;this.scene.add(root);
  let body:THREE.Object3D,mixer:THREE.AnimationMixer|null=null;const actions:Record<string,THREE.AnimationAction>={};let lamp:THREE.SpotLight|undefined;
  if(g.kind==='guard'&&this.template){
   body=clone(this.template);
   body.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;const list=(Array.isArray(o.material)?o.material:[o.material]).map(m=>{const c=m.clone();if(c instanceof THREE.MeshStandardMaterial){const n=c.name.toLowerCase();if(n.includes('accent'))c.color.set('#2a4a78');else if(/^skin/.test(n))c.color.set('#9a6a4f');else c.color.multiplyScalar(.75).add(new THREE.Color('#0d1a2e'));}return c;});o.material=Array.isArray(o.material)?list:list[0];}
    if(o.name.startsWith('Loot_')||/^(Slim_technical_backpack|Backpack_|Pack_zipper)/.test(o.name))o.visible=false;});
   const head=body.getObjectByName('Head');
   if(head){const cap=new THREE.Mesh(new THREE.CylinderGeometry(.13,.14,.08,16),mat('#1a2a44',.6));cap.position.set(0,.2,0);const brim=new THREE.Mesh(new THREE.BoxGeometry(.24,.02,.14),mat('#1a2a44',.6));brim.position.set(0,.17,.12);head.add(cap,brim);}
   mixer=new THREE.AnimationMixer(body);
   for(const clip of this.animations){const token=clip.name.replace(/(?:[._-]\d+)+$/,'').toLowerCase();const name=['crouchidle','interact','crouch','walk','run','idle'].find(k=>token===k||token.endsWith(k));if(!name||actions[name])continue;const a=mixer.clipAction(clip);a.setEffectiveWeight(0);a.play();actions[name]=a;}
   actions.idle?.setEffectiveWeight(1);
   lamp=new THREE.SpotLight('#fff1c9',14,10,.42,.55,1.4);lamp.position.set(.18,1.35,.25);lamp.target.position.set(.18,.2,4);root.add(lamp,lamp.target);
   const torch=new THREE.Mesh(new THREE.CylinderGeometry(.035,.045,.22,10),mat('#222',.4,.6));torch.rotation.x=Math.PI/2;torch.position.set(.18,1.3,.32);root.add(torch);
  }else{
   body=new THREE.Group();const dark=mat('#1b232c',.5,.4);
   const pole=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,2.6,8),dark);pole.position.y=1.3;body.add(pole);
   const housing=new THREE.Mesh(new THREE.BoxGeometry(.28,.22,.5),mat('#d8dde3',.4,.2));housing.position.set(0,2.55,.18);body.add(housing);
   const lens=new THREE.Mesh(new THREE.CylinderGeometry(.08,.08,.06,16),new THREE.MeshStandardMaterial({color:'#111',emissive:'#ff3b4e',emissiveIntensity:1.5}));lens.rotation.x=Math.PI/2;lens.position.set(0,2.55,.45);lens.name='lens';body.add(lens);
  }
  root.add(body);
  const segments=28,coneGeo=new THREE.BufferGeometry();coneGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array((segments+2)*3),3));
  const index:number[]=[];for(let i=1;i<=segments;i++)index.push(0,i,i+1);coneGeo.setIndex(index);
  const cone=new THREE.Mesh(coneGeo,new THREE.MeshBasicMaterial({color:'#ffe6a6',transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide}));cone.frustumCulled=false;cone.renderOrder=2;this.scene.add(cone);
  const tag=document.createElement('div');tag.className='guard-tag';tag.innerHTML='<i></i><span></span>';this.labelRoot.append(tag);
  const view={root,body,mixer,actions,active:'idle',cone,coneGeo,tag,lamp};this.guardViews.set(g.id,view);return view;
 }
 private drawGuards(state:HeistState,dt:number,time:number,menu:boolean){
  const ids=new Set(state.guards.map(g=>g.id+':'+state.level));
  for(const[key,v]of this.guardViews)if(!ids.has(key)){this.scene.remove(v.root,v.cone);v.coneGeo.dispose();v.tag.remove();this.guardViews.delete(key);}
  if(!this.template)return;
  for(const g of state.guards){
   const key=g.id+':'+state.level;let v=this.guardViews.get(key);if(!v){v=this.spawnGuardView(g);this.guardViews.delete(g.id);this.guardViews.set(key,v);}
   const prev=v.root.position.clone();v.root.position.lerp(new THREE.Vector3(g.x,0,g.z),1-Math.exp(-14*dt));
   const diff=THREE.MathUtils.euclideanModulo(g.yaw-v.root.rotation.y+Math.PI,Math.PI*2)-Math.PI;v.root.rotation.y+=diff*Math.min(1,dt*10);
   const speed=v.root.position.distanceTo(prev)/Math.max(dt,1e-4);
   const down=g.mode==='stunned'&&g.kind==='guard';
   if(g.kind==='guard'){
    v.body.rotation.x=THREE.MathUtils.lerp(v.body.rotation.x,down?-Math.PI/2:0,1-Math.exp(-8*dt));v.body.position.y=THREE.MathUtils.lerp(v.body.position.y,down?.18:0,1-Math.exp(-8*dt));
    const want=down?'idle':speed>2.6?'run':speed>.3?'walk':'idle';
    if(want!==v.active&&v.actions[want]){const from=v.actions[v.active],to=v.actions[want];to.reset();to.setEffectiveWeight(1);to.play();if(from)to.crossFadeFrom(from,.2,false);v.active=want;}
    v.actions[v.active]?.setEffectiveTimeScale(down?0:v.active==='walk'?THREE.MathUtils.clamp(speed/1.4,.6,1.4):1);
    v.mixer?.update(dt);
    if(v.lamp){v.lamp.visible=!down;v.lamp.color.set(g.mode==='confront'?'#ff6b78':'#fff1c9');}
   }else{
    const lens=v.body.getObjectByName('lens') as THREE.Mesh|undefined;if(lens)(lens.material as THREE.MeshStandardMaterial).emissiveIntensity=g.mode==='stunned'?0:g.mode==='alert'?4:1.2+Math.sin(time*.006)*.4;
   }
   // Vision cone, clipped by walls exactly as the simulation's sight test.
   const cone=v.cone,showCone=!down&&!menu&&state.phase==='playing';cone.visible=showCone;
   if(showCone){
    const range=guardRange(g),fov=g.kind==='camera'?GUARD_CONSTANTS.CAMERA_FOV:GUARD_CONSTANTS.FOV,pos=v.coneGeo.getAttribute('position') as THREE.BufferAttribute,n=pos.count-2,origin={x:v.root.position.x,z:v.root.position.z};
    pos.setXYZ(0,origin.x,.035,origin.z);
    for(let i=0;i<=n;i++){const a=g.yaw-fov/2+fov*i/n,r=visionReach(state,origin,a,range);pos.setXYZ(i+1,origin.x+Math.sin(a)*r,.035,origin.z+Math.cos(a)*r);}
    pos.needsUpdate=true;v.coneGeo.computeBoundingSphere();
    const mtl=cone.material as THREE.MeshBasicMaterial;mtl.color.set(g.mode==='alert'||g.mode==='confront'?'#ff3b4e':g.mode==='suspicious'||g.mode==='search'?'#ffb547':g.kind==='camera'?'#ff8a95':'#fff1c9');mtl.opacity=g.mode==='alert'||g.mode==='confront'?.32:g.mode==='patrol'?.13+g.suspicion*.2:.24;
   }
   // Awareness tag: ? while suspicious, ! once alerted, z while knocked out.
   const show=!menu&&state.phase==='playing'&&(g.suspicion>.03||g.mode!=='patrol');
   const icon=g.mode==='alert'||g.mode==='confront'?'!':g.mode==='stunned'?(g.kind==='camera'?'OFF':'z'):'?';
   v.tag.dataset.mode=g.mode;(v.tag.firstElementChild as HTMLElement).textContent=icon;v.tag.style.setProperty('--s',String(g.mode==='alert'||g.mode==='confront'?1:g.suspicion));
   (v.tag.lastElementChild as HTMLElement).textContent=g.kind==='camera'?(g.mode==='stunned'?'CAMERA OFFLINE':'CAMERA'):g.mode==='stunned'?'OUT COLD':g.mode==='confront'?'STOPPED YOU':g.mode==='alert'?'ALARM':g.mode==='search'?'SEARCHING':'SUSPICIOUS';
   this.positionLabel(v.tag,v.root.position.clone().add(new THREE.Vector3(0,g.kind==='camera'?3.1:down?.8:2.25,0)),show);
  }
 }
}
