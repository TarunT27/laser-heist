import * as THREE from 'three';
import {laserAt} from '../../shared/heist';

const HEIGHTS=[.55,1.25];
const metal=(color:string,roughness=.4,metalness=.65)=>new THREE.MeshStandardMaterial({color,roughness,metalness});

/** A moving clear passage between two physical optical receivers. */
export class LaserGate {
 readonly root=new THREE.Group();
 readonly receivers=[new THREE.Group(),new THREE.Group()];
 readonly beams:THREE.Group[]=[];
 readonly contacts:THREE.Mesh[]=[];
 private lamps:THREE.MeshStandardMaterial[]=[];
 constructor(readonly index:number,readonly level:number){
  this.root.name=`Laser_gate_${index}`;
  this.root.position.z=laserAt(0,index,level).z;
  const body=metal('#17252b'),edge=metal('#809296',.27,.8),track=metal('#34484c',.55),brass=metal('#ac9565',.32,.7);
  const box=(size:number[],pos:number[],material:THREE.Material,parent=this.root)=>{
   const mesh=new THREE.Mesh(new THREE.BoxGeometry(size[0],size[1],size[2]),material);
   mesh.position.set(pos[0],pos[1],pos[2]);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  };
  // Recessed tracks explain how the gap moves. No beam ends in empty space.
  box([14.4,.025,.22],[0,.0125,.16],body);
  for(const z of [.095,.225])box([14.4,.012,.018],[0,.03,z],edge);
  const contactMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(2.8,.06,.12),toneMapped:false});
  const housing=(group:THREE.Group,facing:number,mobile:boolean)=>{
   box([mobile?.25:.34,.07,.36],[0,.055,.14],track,group);
   box([.085,1.40,.10],[-facing*.055,.77,.14],body,group);
   box([.025,1.27,.012],[-facing*.102,.76,.199],brass,group);
   box([.18,.08,.24],[-facing*.05,1.49,.10],edge,group);
   const status=new THREE.MeshStandardMaterial({color:'#ff3151',emissive:'#ff1037',emissiveIntensity:2});this.lamps.push(status);
   box([.03,.045,.014],[-facing*.05,1.49,.229],status,group);
   for(const y of HEIGHTS){
    box([.12,.15,.19],[-facing*.075,y,.085],body,group);
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.085,.085,.15,20),edge);barrel.rotation.z=Math.PI/2;barrel.position.set(-facing*.075,y,0);barrel.castShadow=true;group.add(barrel);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(.061,.012,8,24),body);rim.rotation.y=Math.PI/2;rim.position.set(0,y,0);group.add(rim);
    const glass=new THREE.Mesh(new THREE.CircleGeometry(.048,24),new THREE.MeshStandardMaterial({color:'#8b122d',emissive:'#ca1538',emissiveIntensity:.5,metalness:.45,roughness:.12,side:THREE.DoubleSide}));glass.rotation.y=Math.PI/2;glass.position.set(0,y,0);group.add(glass);
    const contact=new THREE.Mesh(new THREE.SphereGeometry(.035,12,8),contactMaterial);contact.position.set(0,y,0);contact.name='Laser_contact';contact.userData.opticalEffect=true;group.add(contact);this.contacts.push(contact);
   }
  };
  for(const side of [-1,1]){
   const fixed=new THREE.Group();fixed.name=side<0?'Left_emitter':'Right_emitter';fixed.position.x=side*7;housing(fixed,-side,false);this.root.add(fixed);
  }
  this.receivers.forEach((group,i)=>{group.name=i===0?'Left_sliding_receiver':'Right_sliding_receiver';housing(group,i===0?-1:1,true);this.root.add(group);});
  const coreMaterial=new THREE.MeshBasicMaterial({color:new THREE.Color(3.0,.13,.20),toneMapped:false});
  const haloMaterial=new THREE.MeshBasicMaterial({color:'#ff123b',transparent:true,opacity:.16,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
  for(const y of HEIGHTS)for(let side=0;side<2;side++){
   const segment=new THREE.Group();segment.name=`Beam_${y}_${side}`;segment.position.y=y;
   for(const [radius,material] of [[.012,coreMaterial],[.045,haloMaterial]] as const){
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,1,10),material);mesh.rotation.z=Math.PI/2;mesh.userData.opticalEffect=true;segment.add(mesh);
   }
   this.root.add(segment);this.beams.push(segment);
  }
  this.update(0);
 }
 update(elapsed:number){
  const laser=laserAt(elapsed,this.index,this.level),left=laser.x-1.25,right=laser.x+1.25;
  this.receivers[0].position.x=left;this.receivers[1].position.x=right;
  const ranges=[[-7,left],[right,7]];
  this.beams.forEach((segment,i)=>{const[a,b]=ranges[i%2];segment.position.x=(a+b)/2;segment.scale.x=Math.max(.0001,b-a);segment.visible=laser.active&&b-a>.005;});
  for(const contact of this.contacts)contact.visible=laser.active;
  for(const lamp of this.lamps){lamp.color.set(laser.active?'#ff3151':'#73b6a1');lamp.emissive.set(laser.active?'#ff1037':'#245e4b');lamp.emissiveIntensity=laser.active?2:.5;}
 }
}

/** Fixed emitter/receiver curtains for the map framework's timed hazard sectors. */
export class SecurityLaserSector {
 readonly root=new THREE.Group();
 readonly light=new THREE.Group();
 readonly indicators:THREE.MeshStandardMaterial[]=[];
 constructor(sector:{id:string;x:number;z:number;w:number;d:number},high=false){
  const heights=high?[1.15]:[.48,1.15];
  this.root.name='laser-sector:'+sector.id;this.root.position.set(sector.x,0,sector.z);
  const acrossX=sector.w>=sector.d,width=acrossX?sector.w:sector.d,depth=acrossX?sector.d:sector.w;
  if(!acrossX)this.root.rotation.y=Math.PI/2;
  this.root.add(this.light);
  const dark=metal('#203038'),steel=metal('#7f969b',.25,.8);
  const core=new THREE.MeshBasicMaterial({color:new THREE.Color(2.6,.06,.13),toneMapped:false});
  const halo=new THREE.MeshBasicMaterial({color:'#ff1648',transparent:true,opacity:.14,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false});
  const rows=Math.max(2,Math.ceil(depth/.5)+1);
  const box=(size:number[],position:number[],material:THREE.Material)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(size[0],size[1],size[2]),material);mesh.position.set(position[0],position[1],position[2]);mesh.castShadow=true;this.root.add(mesh);return mesh;};
  for(const side of [-1,1]){
   box([.14,.06,depth+.25],[side*(width/2+.09),.04,0],steel);
   for(let row=0;row<rows;row++){
    const z=-depth/2+depth*row/(rows-1);
    box([.14,1.40,.14],[side*(width/2+.09),.74,z],dark);
    const indicator=new THREE.MeshStandardMaterial({color:'#fc395d',emissive:'#ff1744',emissiveIntensity:2});this.indicators.push(indicator);
    box([.12,.04,.12],[side*(width/2+.09),1.46,z],indicator);
    for(const y of heights){
     const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.075,.075,.18,16),steel);barrel.rotation.z=Math.PI/2;barrel.position.set(side*(width/2+.09),y,z);this.root.add(barrel);
     const ring=new THREE.Mesh(new THREE.TorusGeometry(.053,.01,8,16),dark);ring.rotation.y=Math.PI/2;ring.position.set(side*width/2,y,z);this.root.add(ring);
     const point=new THREE.Mesh(new THREE.SphereGeometry(.035,10,6),core);point.position.set(side*width/2,y,z);this.light.add(point);
    }
   }
  }
  for(let row=0;row<rows;row++)for(const y of heights)for(const [radius,material]of [[.012,core],[.045,halo]]as const){
   const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,width,10),material);mesh.rotation.z=Math.PI/2;mesh.position.set(0,y,-depth/2+depth*row/(rows-1));mesh.userData.opticalEffect=true;this.light.add(mesh);
  }
 }
 update(active:boolean){this.light.visible=active;for(const material of this.indicators){material.color.set(active?'#fc395d':'#7bcfb0');material.emissive.set(active?'#ff1744':'#23614d');material.emissiveIntensity=active?2:.6;}}
}
