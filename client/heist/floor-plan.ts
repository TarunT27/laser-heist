import { MAPS, ROLE_NAMES, crewPerk, gateOpen, sectorTiming, objectiveAvailable, type HeistState, type HeistPlayer } from '../../shared/heist';
import type { Point } from './navigation';
/** The plan is generated from exactly the geometry used for authoritative collision. */
export function drawFloorPlan(canvas:HTMLCanvasElement,state:HeistState,localId:string,colors:string[],route:Point|null){
 const c=canvas.getContext('2d')!,detail=canvas.id==='big-map',w=detail?960:240,h=w*.75,density=Math.min(devicePixelRatio,2);
 canvas.width=w*density;canvas.height=h*density;c.setTransform(canvas.width/800,0,0,canvas.height/600,0,0);
 const x=(v:number)=>(v+16)*25,z=(v:number)=>(v+12)*25;
 const box=(r:{x:number;z:number;w:number;d:number},color:string)=>{c.fillStyle=color;c.fillRect(x(r.x-r.w/2),z(r.z-r.d/2),r.w*25,r.d*25);};
 const text=(label:string,a:number,b:number,color='#e8d6b2')=>{if(!detail)return;c.font='bold 10px sans-serif';c.textAlign='center';c.fillStyle=color;c.fillText(label,x(a),z(b));};
 c.fillStyle='#0a1825';c.fillRect(0,0,800,600);const m=MAPS[state.level];
 m.floors.forEach(f=>box(f,'#284448'));m.rooms.forEach(r=>text(r.label,r.x,r.z+r.d/2-.5,'#94aaa6'));
 for(const sector of m.sectors){const t=sectorTiming(state,sector);box(sector,t.cut?'#2c4a45':t.active?'#b74b47':'#38695d');}
 for(const wall of m.walls)box(wall,'#d2ceaf');
 for(const gate of m.gates){const open=gateOpen(state,gate,{crouching:true} as HeistPlayer);box(gate,open?'#83d7b2':'#f28e70');if(open&&gate.swing)box(gate.swing,'#9aa7a6');text(gate.label+(open?' · OPEN':' · CLOSED'),gate.x,gate.z+.5);}
 if(state.mission?.kind!=='setup'){c.strokeStyle='#87e3c1';c.setLineDash([8,8]);c.lineWidth=3;c.beginPath();m.escape.forEach((p,i)=>i?c.lineTo(x(p.x),z(p.z)):c.moveTo(x(p.x),z(p.z)));c.stroke();c.setLineDash([]);}
 // Cased the joint (or tapped their radio): every guard's patrol loop is drawn.
 if(state.mods?.showRoutes||crewPerk(state,'radio')){c.strokeStyle='#ffe6a666';c.lineWidth=2;c.setLineDash([4,6]);for(const g of m.guards){c.beginPath();g.route.forEach((p,i)=>i?c.lineTo(x(p.x),z(p.z)):c.moveTo(x(p.x),z(p.z)));if(g.route.length>2)c.closePath();c.stroke();}c.setLineDash([]);}
 if(state.mission?.kind==='setup'){for(const t of state.mission.targets){c.fillStyle=t.done?'#8bccaf':'#ffb547';c.save();c.translate(x(t.x),z(t.z));c.rotate(Math.PI/4);c.fillRect(-7,-7,14,14);c.restore();text(t.label,t.x,t.z-.6);}if(state.mission.targets.every(t=>t.done)){c.strokeStyle='#4fd18b';c.lineWidth=3;c.beginPath();c.arc(x(state.mission.exit.x),z(state.mission.exit.z),40,0,Math.PI*2);c.stroke();text('EXIT',state.mission.exit.x,state.mission.exit.z);}}
 else{const crew=new Set(state.players.filter(p=>p.connected).map(p=>p.role)),me=state.players.find(p=>p.id===localId);
  for(const o of m.objectives){const done=state.completed.includes(o.id)||!!(o.release&&state.completed.includes(o.release)),available=objectiveAvailable(state,o),job=o.kind==='assist';
   // Crew jobs are diamonds: yours bright, a teammate's dimmer, and greyed out when nobody on the crew has that role.
   c.fillStyle=done?'#8bccaf':job&&!crew.has(o.role!)?'#3d4b4f':available?(job&&o.role!==me?.role?'#b9a173':'#f2ca85'):'#657a7c';c.beginPath();if(job){c.save();c.translate(x(o.x),z(o.z));c.rotate(Math.PI/4);const r=detail?7:10;c.fillRect(-r,-r,r*2,r*2);c.restore();}else c.arc(x(o.x),z(o.z),detail?7:11,0,Math.PI*2);c.fill();
   text(job?`${ROLE_NAMES[o.role!]}: ${o.label}`:o.label,o.x,o.z-.5,job&&!crew.has(o.role!)?'#7d8a8c':undefined);if(state.clamps[o.id]?.installed)text('CLAMPED',o.x,o.z+.55,'#6ce7ff');}}
 if(state.mission?.kind!=='setup'){c.strokeStyle='#a0edc9';c.lineWidth=3;c.beginPath();c.arc(x(m.exit.x),z(m.exit.z),50,0,Math.PI*2);c.stroke();text('EXTRACT',m.exit.x,m.exit.z);}
 if(state.cargo.loaded){box({...state.cargo,w:.8,d:.8},'#ffd164');text('CARGO',state.cargo.x,state.cargo.z-.8);}
 // Guards and cameras with their facing wedge, coloured by awareness.
 for(const g of state.guards??[]){const color=g.mode==='alert'?'#ff3b4e':g.mode==='stunned'?'#56606c':g.mode==='patrol'?'#ffe6a6':'#ffb547';const fov=g.kind==='camera'?1.26:1.88,r=g.kind==='camera'?8.5:7.5;
  if(g.mode!=='stunned'){c.fillStyle=color+'33';c.beginPath();c.moveTo(x(g.x),z(g.z));for(let i=0;i<=12;i++){const a=g.yaw-fov/2+fov*i/12;c.lineTo(x(g.x+Math.sin(a)*r),z(g.z+Math.cos(a)*r));}c.closePath();c.fill();}
  c.fillStyle=color;if(g.kind==='camera')c.fillRect(x(g.x)-5,z(g.z)-5,10,10);else{c.beginPath();c.arc(x(g.x),z(g.z),detail?7:9,0,Math.PI*2);c.fill();}text(g.kind==='camera'?'CAM':g.mode==='stunned'?'OUT':'GUARD',g.x,g.z-.6,color);}
 for(const p of state.players.filter(p=>p.connected)){c.fillStyle=colors[p.color%4];c.beginPath();c.arc(x(p.x),z(p.z),p.id===localId?8:6,0,Math.PI*2);c.fill();text(p.id===localId?'YOU':p.name,p.x,p.z-.6,'#fff');}
 for(const ping of state.pings.filter(p=>p.until>state.elapsed)){text('PING',ping.x,ping.z,'#fff');}
 if(route){c.strokeStyle='#fff';c.beginPath();c.arc(x(route.x),z(route.z),12,0,Math.PI*2);c.stroke();}
}
