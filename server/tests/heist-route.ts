import {MAPS,stepHeist,createHeistState,startHeist,type HeistState,type HeistInput,type Role,sectorTiming} from '../../shared/heist';
import {Navigator} from '../../client/heist/navigation';
export const roles:Role[]=['hacker','infiltrator','carrier','lookout'];
export function makeRun(level:number,crew:Role[]){const s=createHeistState('ROUTE','p0',crew.map((role,i)=>({id:'p'+i,name:'Crew '+i,role})));s.level=level;startHeist(s);
 // Route tests verify the objective graph and physical routing; guard behaviour has its own tests.
 s.guards=[];return s;}
/** Drives real movement and interaction only. No mutation of positions, gates or progress. */
export class RouteDriver {
 nav=new Navigator();stage=0;
 constructor(public state:HeistState){}
 inputs():Record<string,HeistInput>{
  const s=this.state,m=MAPS[s.level],p=s.players.find(p=>p.connected)!,result:Record<string,HeistInput>={};
  const sequences=[['entry','case','signal','release','isolate','loot'],['entry','auth-west','auth-east','van','pressure','isolate','loot','gate-a','cross-a','gate-b','cross-b'],['entry','relay','screens','cooling','isolate','loot']];
  const seq=sequences[s.level];
  while(this.stage<seq.length){const id=seq[this.stage];if(s.completed.includes(id)||s.completed.includes(m.objectives.find(o=>o.id===id)?.release??'')||s.clamps[id]?.installed||(id==='cross-a'&&s.completed.includes('freight-a'))||(id==='cross-b'&&s.completed.includes('freight-b')))this.stage++;else break;}
  const id=seq[this.stage],o=m.objectives.find(o=>o.id===id);
  let target=o??m.exit,interact=false,crouch=!p.carrying;
  if(id==='cross-a')target={x:7,z:-9.5};if(id==='cross-b')target={x:12,z:3};
  // Return to a braked cart after operating the gate. Driving requires holding E.
  const driving=m.cargo==='cart'&&s.cargo.loaded&&(!o||o.kind!=='hold');
  if(driving&&!s.cargo.controller)target=s.cargo;
  const distance=Math.hypot(p.x-target.x,p.z-target.z);
  interact=driving||distance<1.2;
  let move=distance<(o?1.2:.6)?{x:0,z:0}:this.nav.steer(s,{...p,crouching:crouch},target,s.elapsed*1000);
  // Respect visible security windows. Shelters sit outside each sector.
  if(m.sectors.some(h=>sectorTiming(s,h).active&&Math.abs(p.x+move.x*.7-h.x)<h.w/2+.15&&Math.abs(p.z+move.z*.7-h.z)<h.d/2+.15))move={x:0,z:0};
  result[p.id]={...move,crouch,interact,yaw:Math.atan2(-move.x,-move.z)};
  for(const other of s.players.filter(q=>q.connected&&q.id!==p.id)){
   const dest=s.diamondTaken?m.exit:other;
   const move=this.nav.steer(s,{...other,crouching:true},dest,s.elapsed*1000);
   result[other.id]={...move,crouch:true,interact:false};
  }
  return result;
 }
}
export function finishRun(s:HeistState,maxSeconds=650){const driver=new RouteDriver(s);for(let i=0;i<maxSeconds*30&&s.phase==='playing';i++)stepHeist(s,driver.inputs(),1/30);return s;}
