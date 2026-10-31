export type Career={clears:number;earnings:number;cleanRuns:number;best:number[]};
export const emptyCareer=():Career=>({clears:0,earnings:0,cleanRuns:0,best:[0,0,0]});
export function readCareer(value:string|null):Career{
 try{const p=JSON.parse(value||'null');if(!p)return emptyCareer();const n=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:0;
 return{clears:n(p.clears),earnings:n(p.earnings),cleanRuns:n(p.cleanRuns),best:[0,1,2].map(i=>n(p.best?.[i]))};}catch{return emptyCareer();}
}
export function recordClear(career:Career,level:number,personalPayout:number,alarms:number):Career{
 const next={...career,best:[...career.best]};const payout=Math.max(0,Math.floor(personalPayout));
 next.clears++;next.earnings+=payout;if(alarms===0)next.cleanRuns++;
 next.best[level]=Math.max(next.best[level]||0,payout);return next;
}
