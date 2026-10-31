import {canOccupyHeist,MAPS,type HeistState,type HeistPlayer} from '../../shared/heist';
export type Point={x:number;z:number};
const STEP=.55,MIN_X=-15.4,MIN_Z=-11.4,COLS=57,ROWS=43;
/** Small deterministic A* used by the practice crew and optional map navigation. */
export function findPath(state:HeistState,player:HeistPlayer,target:Point):Point[]{
 const toCell=(p:Point)=>({x:Math.max(0,Math.min(COLS-1,Math.round((p.x-MIN_X)/STEP))),z:Math.max(0,Math.min(ROWS-1,Math.round((p.z-MIN_Z)/STEP)))});
 const point=(key:number)=>({x:MIN_X+(key%COLS)*STEP,z:MIN_Z+Math.floor(key/COLS)*STEP});
 const key=(x:number,z:number)=>z*COLS+x,start=toCell(player),goal=toCell(target),startKey=key(start.x,start.z);
 const open=[startKey],cost=new Map([[startKey,0]]),previous=new Map<number,number>(),closed=new Set<number>();
 const h=(k:number)=>{const p=point(k);return Math.hypot(p.x-target.x,p.z-target.z)/STEP};let best=startKey,bestDistance=h(startKey);
 for(let loops=0;open.length&&loops<2600;loops++){
  let chosen=0,bestScore=Infinity;for(let i=0;i<open.length;i++){const score=cost.get(open[i])!+h(open[i]);if(score<bestScore){chosen=i;bestScore=score;}}
  const current=open.splice(chosen,1)[0];if(closed.has(current))continue;closed.add(current);const currentDistance=h(current);if(currentDistance<bestDistance){best=current;bestDistance=currentDistance;}if(currentDistance<1.5){best=current;break;}
  const cx=current%COLS,cz=Math.floor(current/COLS);
  for(const[dx,dz]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
   const nx=cx+dx,nz=cz+dz;if(nx<0||nz<0||nx>=COLS||nz>=ROWS)continue;const next=key(nx,nz);if(closed.has(next))continue;const p=point(next);
   if(!canOccupyHeist(state,player,p.x,p.z))continue;
   if(dx&&dz){const a=point(key(cx+dx,cz)),b=point(key(cx,cz+dz));if(!canOccupyHeist(state,player,a.x,a.z)||!canOccupyHeist(state,player,b.x,b.z))continue;}
   const hazard=Math.abs(p.x)<7.5&&p.z<.2&&p.z>-8?3:0;const nextCost=cost.get(current)!+(dx&&dz?1.414:1)+hazard;
   if(nextCost<(cost.get(next)??Infinity)){cost.set(next,nextCost);previous.set(next,current);open.push(next);}
  }
 }
 if(best===startKey)return[];const path:Point[]=[];let cursor=best;while(cursor!==startKey){path.push(point(cursor));const prev=previous.get(cursor);if(prev===undefined)break;cursor=prev;}return path.reverse();
}
export class Navigator{
 private paths=new Map<string,{path:Point[];goal:Point;at:number;stamp:string}>();
 clear(id?:string){if(id)this.paths.delete(id);else this.paths.clear();}
 steer(state:HeistState,p:HeistPlayer,goal:Point,now:number){const stamp=`${state.level}:${state.hacked}:${state.switchHeld}:${state.vaultOpen}:${p.crouching}:${state.completed.join()}:${Object.keys(state.clamps).filter(k=>state.clamps[k].installed).join()}`;let entry=this.paths.get(p.id);
 if(!entry||now-entry.at>900||entry.stamp!==stamp||Math.hypot(entry.goal.x-goal.x,entry.goal.z-goal.z)>.8){entry={path:findPath(state,p,goal),goal:{...goal},at:now,stamp};this.paths.set(p.id,entry);}
 while(entry.path.length&&Math.hypot(entry.path[0].x-p.x,entry.path[0].z-p.z)<.22)entry.path.shift();const next=entry.path[0];if(!next)return{x:0,z:0};const dx=next.x-p.x,dz=next.z-p.z,len=Math.hypot(dx,dz);return{x:dx/len,z:dz/len};
 }
}
