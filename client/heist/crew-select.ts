import { asset } from './asset';
import { MAPS, DIFFICULTY, HEIST_CONSTANTS, ROLE_BONUSES, ROLE_NAMES, crewJobs, type Difficulty, type HeistState, type Role } from '../../shared/heist';

/**
 * The crew-select screen an online room shows before a run ("Your Crew", from the Claude Design canvas):
 * pick a role on the left, see its operative, real numbers, perks and crew job on the right, then ready up.
 * Portraits come from tools/build_crew_portraits.py.
 */
export interface CrewActions {
 role(role:Role):void; ready(ready:boolean):void; start():void; level(level:number):void; difficulty(difficulty:Difficulty):void;
 cuts(cuts:Record<string,number>):void; invite():void; leave():void; help():void;
 /** Toggle sound and return the button's new label. */
 sound():string;
 /** The sound button's current label. */
 soundLabel():string;
}

const ORDER:Role[]=['hacker','infiltrator','carrier','lookout'];
const TAGLINE:Record<Role,string>={hacker:'Access specialist. Opens the way in.',infiltrator:'Service-route specialist. Gets inside quietly.',carrier:'Transport specialist. Moves the score.',lookout:'Security specialist. Keeps the crew unseen.'};
const HEADLINE:Record<Role,[string,string]>={hacker:[`${ROLE_BONUSES.HACKER_HACK_MULTIPLIER}×`,'HACK SPEED'],infiltrator:[`${ROLE_BONUSES.INFILTRATOR_OVERRIDE_MULTIPLIER}×`,'OVERRIDES'],carrier:[String(ROLE_BONUSES.CARRIER_LOOT_SPEED),'M/S HAUL'],lookout:[`${ROLE_BONUSES.LOOKOUT_SCANNER_SECONDS}s`,'BLACKOUT']};
const staminaSaving=Math.round((1-HEIST_CONSTANTS.CARRIER_STAMINA_DRAIN/HEIST_CONSTANTS.STAMINA_DRAIN)*100);
type Perk={icon:string;title:string;text:string;job?:boolean};
const PERKS:Record<Role,Perk[]>={
 hacker:[{icon:'terminal',title:'Fast hacks',text:'Entry hacks and terminal authorizations finish in half the time.'}],
 infiltrator:[{icon:'quiet',title:'Silent steps',text:'Footsteps are 40% quieter, so guards have to be much closer to hear you.'},{icon:'unlock',title:'Fast overrides',text:'Inner overrides, like the exhibit interlock and the vault release, finish in half the time.'}],
 carrier:[{icon:'bag',title:'Heavy hauler',text:`Moves the score at ${ROLE_BONUSES.CARRIER_LOOT_SPEED} m/s while everyone else manages ${ROLE_BONUSES.NON_CARRIER_LOOT_SPEED}.`},{icon:'bolt',title:'Deep reserve',text:`Sprinting drains stamina ${staminaSaving}% slower.`}],
 lookout:[{icon:'camoff',title:'Long blackout',text:`Security consoles kill the cameras for ${ROLE_BONUSES.LOOKOUT_SCANNER_SECONDS} seconds instead of ${HEIST_CONSTANTS.SCANNER_SECONDS}.`},{icon:'talk',title:'Smooth talker',text:'The bluff window is 35% wider when a guard stops you.'}],
};
const svg=(body:string,size=28,width=1.8)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS:Record<string,string>={
 terminal:'<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 9l3 3-3 3M12.5 15H17"/>',
 quiet:'<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
 unlock:'<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.8M12 15v2"/>',
 bag:'<path d="M4.5 8.5h15l-1.2 12H5.7l-1.2-12z"/><path d="M9 8.5V6.5a3 3 0 0 1 6 0v2"/>',
 bolt:'<path d="M13 2.5L4.5 13.5h6.5l-1 8 8.5-11h-6.5l1-8z"/>',
 camoff:'<path d="M3 7.5h11v9H3z"/><path d="M14 10.5l6-3v9l-6-3M2.5 3.5l19 17"/>',
 talk:'<path d="M4 5h16v11H9.5L4 20V5z"/><path d="M8 9.5h8M8 12.5h5"/>',
 job:'<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
};
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(n:number)=>'$'+Math.floor(n).toLocaleString('en-US');
const clock=(s:number)=>{const t=Math.ceil(Math.max(0,s));return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;};

export class CrewSelect {
 private perk:number|null=null;private shownRole:Role|null=null;private signature='';private last:{state:HeistState;localId:string}|null=null;
 constructor(private root:HTMLElement,private actions:CrewActions){}

 /** Re-render when anything the screen shows has changed; the split dialog is never rebuilt under the host's cursor. */
 update(state:HeistState,localId:string,force=false){
  const me=state.players.find(p=>p.id===localId&&p.connected);if(!me)return;
  if(me.role!==this.shownRole){this.shownRole=me.role;this.perk=null;}
  const signature=JSON.stringify([state.code,state.hostId,state.level,state.difficulty,state.remaining,this.perk,state.players.map(p=>[p.id,p.name,p.role,p.ready,p.cut,p.connected])]);
  if(!force&&(signature===this.signature||this.root.querySelector('dialog[open]')))return;
  this.signature=signature;this.last={state,localId};this.render(state,localId);
 }

 private render(state:HeistState,localId:string){
  const crew=state.players.filter(p=>p.connected),me=crew.find(p=>p.id===localId)!,host=state.hostId===localId,role=me.role,map=MAPS[state.level];
  const job=crewJobs(state.level).find(o=>o.role===role);
  const perks:Perk[]=[...PERKS[role],...(job?[{icon:'job',title:job.label,text:`${job.hint} Only a ${ROLE_NAMES[role]} can do it, and it lasts the whole run.`,job:true}]:[])];
  const current=perks[Math.min(this.perk??perks.length-1,perks.length-1)];
  const mates=crew.filter(p=>p.role===role&&p.id!==localId).map(p=>p.name);
  const allReady=crew.every(p=>p.ready),cutTotal=crew.reduce((n,p)=>n+p.cut,0);
  const stat=(label:string,mine:boolean,value:number,base:number,max:number,unit:string)=>{const v=mine?value:base;return `<div class="cs-stat"><div><span>${label}</span><b>${unit==='x'?v.toFixed(1)+'×':v+unit}</b></div><i><s style="width:${Math.round(v/max*100)}%"${mine?' class="mine"':''}></s></i></div>`;};
  const who=(r:Role)=>{const names=crew.filter(p=>p.role===r).sort((a,b)=>Number(b.id===localId)-Number(a.id===localId)).map(p=>p.id===localId?'You':`${esc(p.name)} · ${p.ready?'ready':'not ready'}`);return names.length?names.join(' + '):'Open';};
  const contract=host?`<label class="cs-select"><span class="sr">Contract</span><select data-cs="level">${MAPS.map((m,i)=>`<option value="${i}" ${i===state.level?'selected':''}>CONTRACT 0${i+1} · ${esc(m.name.toUpperCase())}</option>`).join('')}</select></label><label class="cs-select"><span class="sr">Difficulty</span><select data-cs="difficulty">${(Object.keys(DIFFICULTY) as Difficulty[]).map(d=>`<option value="${d}" ${d===state.difficulty?'selected':''}>${DIFFICULTY[d].label.toUpperCase()}</option>`).join('')}</select></label>`
   :`<span class="cs-contract">CONTRACT 0${state.level+1} · ${esc(map.name.toUpperCase())} · ${DIFFICULTY[state.difficulty].label.toUpperCase()}</span>`;
  const button=host&&allReady?{label:'START HEIST',cls:'go',act:'start'}:me.ready?{label:'READY ✓',cls:'ready',act:'unready'}:{label:'READY UP',cls:'',act:'ready'};
  const note=cutTotal!==100?'The split must add up to 100% before anyone can ready.':me.ready?(allReady?(host?'Whole crew is ready. Start when you are.':'Whole crew is ready. Waiting for the host to start.'):`Waiting for ${crew.filter(p=>!p.ready).map(p=>p.name).join(', ')}.`):'Any role can finish the heist alone. Your role just changes how.';
  this.root.dataset.role=role;
  this.root.innerHTML=`
<header class="cs-head">
 <div class="cs-title"><button type="button" class="cs-back" data-cs="leave" aria-label="Leave crew">${svg('<path d="M15 5l-7 7 7 7"/>',26,2.4)}</button>
  <div><h1>Your Crew</h1><div class="cs-contract-row">${contract}</div></div></div>
 <div class="cs-chips">
  <div class="cs-chip"><span>ROOM ${esc(state.code)}</span><button type="button" data-cs="invite">${svg('<path d="M12 5v14M5 12h14"/>',16,2.4)}INVITE</button></div>
  <div class="cs-chip"><small>TAKE</small><strong>${money(map.loot)}</strong></div>
  <button type="button" class="cs-plain" data-cs="help">How to play</button><button type="button" class="cs-plain" data-cs="sound">${esc(this.actions.soundLabel())}</button>
 </div>
</header>
<div class="cs-stage" aria-hidden="true"><i class="cs-ring"></i><i class="cs-ring small"></i><img src="${asset(`heist/portraits/hero-${role}.webp`)}" alt=""></div>
<section class="cs-roles" aria-label="Crew roles">
 <div class="cs-roles-head"><span>ROLES</span><small>Duplicates are fine</small></div>
 ${ORDER.map(r=>`<button type="button" class="cs-role ${r===role?'on':''}" data-role="${r}" aria-pressed="${r===role}"><img src="${asset(`heist/portraits/thumb-${r}.webp`)}" alt=""><span><strong><i class="dot-${r}" aria-hidden="true"></i>${ROLE_NAMES[r].toUpperCase()}</strong><small>${who(r)}</small></span></button>`).join('')}
 <button type="button" class="cs-invite" data-cs="invite"><span><strong>INVITE CREW</strong><small>${crew.length} of ${HEIST_CONSTANTS.MAX_PLAYERS} · ${crew.length<HEIST_CONSTANTS.MAX_PLAYERS?'copy the room link':'crew is full'}</small></span><i>${svg('<path d="M12 5v14M5 12h14"/>',22,2)}</i></button>
 <p class="cs-facts">${[map.guards.length?`${map.guards.length} guards`:'',map.cameras.length?`${map.cameras.length} camera${map.cameras.length>1?'s':''}`:'',`${map.sectors.length} ${state.level===2?'searchlights':'laser zones'}`].filter(Boolean).join(' · ')} · ${clock(state.remaining)} on the clock. ${esc(DIFFICULTY[state.difficulty].blurb)}</p>
</section>
<section class="cs-detail" aria-label="${ROLE_NAMES[role]} details">
 <div class="cs-hero"><div class="cs-big"><span>${HEADLINE[role][0]}</span><small>${HEADLINE[role][1]}</small></div>
  <div><h2>${ROLE_NAMES[role].toUpperCase()}</h2><p>${TAGLINE[role]}</p><small class="cs-crewline">${mates.length?'ALSO ON THIS ROLE: '+esc(mates.join(', ').toUpperCase()):'ONLY YOU ON THIS ROLE'}</small></div></div>
 <div class="cs-stats">${stat('HACK SPEED',role==='hacker',ROLE_BONUSES.HACKER_HACK_MULTIPLIER,1,ROLE_BONUSES.HACKER_HACK_MULTIPLIER,'x')}${stat('OVERRIDES',role==='infiltrator',ROLE_BONUSES.INFILTRATOR_OVERRIDE_MULTIPLIER,1,ROLE_BONUSES.INFILTRATOR_OVERRIDE_MULTIPLIER,'x')}${stat('HAUL SPEED',role==='carrier',ROLE_BONUSES.CARRIER_LOOT_SPEED,ROLE_BONUSES.NON_CARRIER_LOOT_SPEED,ROLE_BONUSES.CARRIER_LOOT_SPEED,' m/s')}${stat('CAMERA BLACKOUT',role==='lookout',ROLE_BONUSES.LOOKOUT_SCANNER_SECONDS,HEIST_CONSTANTS.SCANNER_SECONDS,ROLE_BONUSES.LOOKOUT_SCANNER_SECONDS,' s')}</div>
 <div class="cs-perks"><span class="cs-label">PERKS</span><div class="cs-tiles">${perks.map((p,i)=>`<button type="button" data-perk="${i}" class="${p===current?'on':''}" aria-pressed="${p===current}" aria-label="${esc(p.title)}">${svg(ICONS[p.icon])}</button>`).join('')}</div>
  <div class="cs-perk"><small class="${current.job?'job':''}">${current.job?'CREW JOB · OPTIONAL':'SPECIALTY'}</small><strong>${esc(current.title)}</strong><span>${esc(current.text)}</span></div></div>
 <div class="cs-go">
  <div class="cs-split"><span class="cs-label">SPLIT</span><span>${crew.map(p=>`${p.id===localId?'You':esc(p.name)} ${p.cut}%`).join(' · ')}</span>${host?'<button type="button" class="cs-plain" data-cs="split">Edit</button>':''}</div>
  <div class="cs-note"><p>${esc(note)}</p>${host&&allReady?'<button type="button" class="cs-plain" data-cs="unready">Unready</button>':''}</div>
  <button type="button" class="cs-ready ${button.cls}" data-cs="${button.act}" ${cutTotal!==100&&!me.ready&&button.act==='ready'?'disabled':''}>${button.label}<i></i><i></i><i></i><i></i></button>
 </div>
</section>
<dialog class="cs-dialog" id="cs-split"><h3>Profit split</h3><p>Everyone readies again after a change. The cuts must add up to 100%.</p>
 ${crew.map(p=>`<label><span>${p.id===localId?'You':esc(p.name)} · ${ROLE_NAMES[p.role]}</span><input type="number" min="0" max="100" step="1" value="${p.cut}" data-cut="${esc(p.id)}"><b>%</b></label>`).join('')}
 <div><button type="button" class="cs-plain" data-cs="split-cancel">Cancel</button><button type="button" class="cs-ready small" data-cs="split-apply">Apply split</button></div></dialog>`;
  this.bind();
 }

 private bind(){
  const q=<T extends HTMLElement>(sel:string)=>this.root.querySelector<T>(sel);
  this.root.querySelectorAll<HTMLButtonElement>('[data-role]').forEach(b=>b.onclick=()=>this.actions.role(b.dataset.role as Role));
  this.root.querySelectorAll<HTMLButtonElement>('[data-perk]').forEach(b=>b.onclick=()=>{this.perk=Number(b.dataset.perk);if(this.last)this.update(this.last.state,this.last.localId,true);this.root.querySelector<HTMLButtonElement>(`[data-perk="${b.dataset.perk}"]`)?.focus();});
  const level=q<HTMLSelectElement>('[data-cs="level"]');if(level)level.onchange=()=>this.actions.level(Number(level.value));
  const difficulty=q<HTMLSelectElement>('[data-cs="difficulty"]');if(difficulty)difficulty.onchange=()=>this.actions.difficulty(difficulty.value as Difficulty);
  const on=(name:string,fn:()=>void)=>this.root.querySelectorAll<HTMLButtonElement>(`[data-cs="${name}"]`).forEach(b=>b.onclick=fn);
  on('leave',()=>this.actions.leave());on('invite',()=>this.actions.invite());on('help',()=>this.actions.help());
  on('sound',()=>{const label=this.actions.sound();this.root.querySelectorAll('[data-cs="sound"]').forEach(b=>b.textContent=label);});
  on('ready',()=>this.actions.ready(true));on('unready',()=>this.actions.ready(false));on('start',()=>this.actions.start());
  const dialog=q<HTMLDialogElement>('#cs-split')!;
  on('split',()=>dialog.showModal());on('split-cancel',()=>dialog.close());
  on('split-apply',()=>{const cuts:Record<string,number>={};dialog.querySelectorAll<HTMLInputElement>('[data-cut]').forEach(el=>cuts[el.dataset.cut!]=Number(el.value));
   if(Object.values(cuts).some(v=>!Number.isInteger(v)||v<0||v>100)||Object.values(cuts).reduce((a,b)=>a+b,0)!==100){dialog.querySelector('p')!.textContent='The cuts must be whole numbers that add up to 100%.';return;}
   dialog.close();this.actions.cuts(cuts);});
 }
}
