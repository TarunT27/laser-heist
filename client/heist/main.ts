import './style.css';
import {readCareer,recordClear,emptyCareer} from './career';
import {drawFloorPlan} from './floor-plan';
import {CrewSelect} from './crew-select';
import {MuseumView,COLORS} from './render';
import {Navigator,type Point} from './navigation';
import {HeistAudio} from './audio';
import {asset} from './asset';
import {loadCampaign,saveCampaign,emptyCampaign} from './campaign-save';
import {createGetaway,stepGetaway,type GetawayState} from './getaway-sim';
import {GetawayView,poseSnapshot,type PoseSnapshot} from './getaway';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import type {Object3D} from 'three';
import {HEISTS,CREW,finaleMods,finaleReady,setupById,crewById} from '../../shared/heist-campaign';
import {MAPS,ROLE_NAMES,crewJobs,claimHeistJob,pingHeist,currentJobs,interactionHint,createHeistState,startHeist,stepHeist,setHeistLevel,nextHeist,startSetup,applyFinaleMods,guardVisibility,takedownTarget,confrontationFor,talkNeedle,DIFFICULTY,type Difficulty,type HeistState,type HeistInput,type HeistServerMessage,type Role} from '../../shared/heist';
const ROLES:Record<Role,{label:string;description:string;number:string}>={infiltrator:{label:'Infiltrator',description:'Quieter footsteps. Overrides twice as fast.',number:'◇'},hacker:{label:'Hacker',description:'Terminals and entry hacks in half the time.',number:'⌘'},carrier:{label:'Carrier',description:'Faster with the loot. Bigger stamina reserve.',number:'▣'},lookout:{label:'Lookout',description:'Longer camera blackouts. Smooth talker.',number:'◎'}};
const roleList=Object.keys(ROLES) as Role[];
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const money=(n:number)=>'$'+Math.floor(n).toLocaleString('en-US');const timeText=(s:number)=>{const total=Math.ceil(Math.max(0,s));return `${Math.floor(total/60).toString().padStart(2,'0')}:${(total%60).toString().padStart(2,'0')}`;};
const ui=document.querySelector<HTMLElement>('#heist-ui')!;
ui.innerHTML=`<div id="vignette" aria-hidden="true"></div><div id="labels" aria-hidden="true"></div><div id="markers" aria-hidden="true"></div>
<header class="topbar"><a href="/" class="brand" aria-label="Laser Heist home"><span class="brand-mark">LH</span><span class="brand-name">LASER HEIST</span></a><div id="session-label">STEALTH CO-OP · 1–4 PLAYERS</div><nav><button id="settings">Settings</button><button id="help">How to play</button><button id="sound" aria-pressed="false">Sound off</button></nav></header>
<div id="screen"></div>
<section id="hud" hidden>
 <aside class="objective"><div class="eyebrow" id="contract-label"></div><div class="panel"><strong id="objective-title"></strong><ul id="objective-list"></ul><div id="crew-jobs" class="crew-jobs"></div></div></aside>
 <div class="status-bar"><div><small>LOCKDOWN</small><strong id="clock"></strong></div><i></i><div><small>TAKE</small><strong id="take" class="gold"></strong></div><i></i><div><small>ALARMS</small><span id="alarm-pips"></span></div></div>
 <div class="hud-actions"><button id="open-map">Map · M</button><button id="pause-game">Pause · Esc</button></div>
 <div class="reticle" aria-hidden="true"></div>
 <div id="detect" aria-hidden="true"><svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"></circle><circle id="detect-fill" class="fill" cx="60" cy="60" r="52" pathLength="100"></circle></svg><i id="detect-arrow"></i></div>
 <div id="talk" role="alertdialog" aria-labelledby="talk-title" hidden><div class="eyebrow bad" id="talk-title">STOPPED BY A GUARD</div><strong>Talk your way out.</strong><p>Press <kbd>SPACE</kbd> when the needle is in the green.</p><div class="talk-bar"><i id="talk-zone"></i><b id="talk-needle"></b></div><div class="talk-clock"><span id="talk-time"></span></div><button id="touch-talk">Talk</button></div>
 <button id="lock-hint">Click to look around with the mouse</button>
 <div class="interaction"><div id="action-prompt"><kbd id="action-key">E</kbd><span id="action-text"></span></div><div id="hold-meter"><span></span></div></div>
 <div class="operator"><div class="op-head"><strong id="op-role"></strong><span id="stance"></span></div>
  <div class="meter"><div class="meter-label"><span>STAMINA</span><span id="stamina-pct"></span></div><div class="bar"><span id="stamina-bar"></span></div></div>
  <div class="meter"><div class="meter-label"><span>NOISE</span><span id="noise-label"></span></div><div class="segments" id="noise-segments"><i></i><i></i><i></i><i></i><i></i></div></div>
  <div class="keys"><span>WASD MOVE</span><span>SHIFT RUN</span><span>C CROUCH</span><span>E USE</span><span>F TAKEDOWN</span><span>P PING</span></div></div>
 <div class="crew-dock"><div class="dock-head"><span>CREW</span><span id="crew-count"></span></div><div id="crew-list"></div><canvas id="mini-map" width="200" height="145" aria-label="Minimap: crew, guards and objectives"></canvas></div>
 <div class="touch-pad"><button data-key="w" aria-label="Move forward">↑</button><div><button data-key="a" aria-label="Move left">←</button><button data-key="s" aria-label="Move backward">↓</button><button data-key="d" aria-label="Move right">→</button></div></div>
 <div class="touch-actions"><button id="touch-takedown">Takedown</button><button id="touch-crouch">Crouch</button><button id="touch-action">Hold to use</button></div>
</section>
<div id="toast" role="status" aria-live="polite"></div>
<div id="loading"><div class="brand-mark big">LH</div><p id="load-message">Preparing your crew…</p></div>
<dialog id="guide"><button class="dialog-close" data-close="guide" aria-label="Close guide">×</button><div class="eyebrow">FIELD GUIDE</div><h2>Stay in the dark.</h2><ol>
 <li><strong>Guards see in cones.</strong> Their flashlight cone on the floor is exactly what they can see. Walls and closed doors block it. Crouch to shrink how far they spot you.</li>
 <li><strong>Plan every score.</strong> Open a heist's planning board: pick an approach, run the setup mission it needs (plus the optional scouting job), hire a hacker and a driver — better crew take a bigger cut — then pull the finale. Van jobs end with a getaway: lose the cops, then reach the drop-off.</li>
 <li><strong>Watch the circle.</strong> When a guard glimpses you, the circle around your crosshair starts filling and its arrow points at them. Break line of sight before it fills.</li>
 <li><strong>Stopped? Talk your way out.</strong> If the circle fills, the guard stops you. Press <kbd>Space</kbd> as the needle crosses the green zone to bluff silently — no alarm. Each guard can be bluffed twice, the second time with a much tighter window; a third sighting by the same guard is busted, and so is a missed or frozen bluff. A teammate can still knock the guard out from behind.</li>
 <li><strong>Noise carries.</strong> Sprinting is loud, walking is soft, crouching is silent. Guards investigate what they hear.</li>
 <li><strong>Take them down.</strong> Sneak up behind an unaware guard and press F. They stay out for 25 seconds.</li>
 <li><strong>Lasers and cameras.</strong> Red floor zones are live beams; wait for the SAFE window. Chest-height beams can be crouched under. Security consoles black out the cameras.</li>
 <li><strong>Three alarms and it's over.</strong> Each alarm costs time and 5% of the take. The third locks the building down.</li>
 <li><strong>Every role has a crew job.</strong> Each map hides four optional jobs, one per role: the Hacker loops the cameras, the Infiltrator cuts the lasers, the Carrier stages the escape gear (+30s and Carrier-speed hauling for all), the Lookout taps the guard radio (guards notice you slower). Only that role can do it and the perk lasts the whole run. Alone you get yours; a full crew gets all four. No map needs them.</li>
 <li><strong>Do the jobs, take the score, leave together.</strong> Hold E at consoles. Hold for six seconds at a switch to clamp it. Bring the loot and the whole crew to the extraction ring.</li></ol>
 <p>Mouse looks (click the game to capture it), WASD moves, Shift sprints, C crouches, E uses, F takes down, M opens the map, P pings. Esc pauses.</p><button class="cta" data-close="guide">Got it</button></dialog>
<dialog id="tactical"><button class="dialog-close" data-close="tactical" aria-label="Close tactical map">×</button><div class="eyebrow">TACTICAL MAP</div><h2>The floor plan.</h2><p>Click the floor to auto-walk there. Amber cones are guards and cameras. Dashed line: the escape route.</p><label>YOUR NEXT JOB <select id="job-choice"><option value="">Choose freely</option></select></label><canvas id="big-map" width="640" height="480" aria-label="Interactive tactical floor plan"></canvas><button id="cancel-route" class="ghost-btn">Cancel walking route</button></dialog>
<dialog id="pause-menu"><div class="eyebrow">PAUSED</div><h2>Catch your breath.</h2><p id="pause-copy"></p><label class="sens">MOUSE SENSITIVITY <input id="sensitivity" type="range" min="8" max="50" value="24"></label><button id="pause-sound" class="ghost-btn">Sound off</button><button id="resume-game" class="cta">Back to the heist</button><button id="pause-leave" class="ghost-btn">Abandon this run</button></dialog>
<dialog id="settings-menu"><button class="dialog-close" data-close="settings-menu" aria-label="Close settings">×</button><div class="eyebrow">SETTINGS</div><h2>Settings.</h2>
 <div class="setting-row"><span><strong>Sound</strong><small>Music, alarms, engine and sirens.</small></span><button id="settings-sound" class="ghost-btn">Sound off</button></div>
 <label class="sens">MOUSE SENSITIVITY <input id="settings-sensitivity" type="range" min="8" max="50" value="24"></label>
 <div class="setting-row danger"><span><strong>Erase all progress</strong><small>Account, unlocked heists, setups and records on this browser.</small></span><button id="reset-progress" class="ghost-btn">Erase progress</button></div>
 <button class="cta" data-close="settings-menu">Done</button></dialog>`;
const pauseButton=$<HTMLButtonElement>('pause-game');
let career=emptyCareer();try{career=readCareer(localStorage.getItem('laser-career-v1'));}catch{}
let campaign=loadCampaign();
/** The campaign job in progress (null for quick practice and online rooms) and the getaway drive, when one is running. */
let run:{level:number;kind:'setup'|'finale';setupId?:string}|null=null,getaway:{sim:GetawayState;view:GetawayView;acc:number;take:number;outro:number|null;before:PoseSnapshot|null}|null=null;
let lastNotice='';
/** Online rooms need the Node server. On static hosting (GitHub Pages) /health is missing, so the menu offers solo play only. */
let onlineAvailable:boolean|null=null;
function applyOnline(){const form=document.getElementById('entry-form');if(!form||onlineAvailable!==false)return;form.innerHTML='<div class="eyebrow muted">PLAY ONLINE</div><p class="fine">Online rooms need the game server (<code>npm start</code>). This copy is solo-only — the whole campaign is here.</p>';}
// Some static hosts answer any path with the page itself, so require the server's own {"ok":true} health reply.
function checkOnline(){fetch(asset('health'),{cache:'no-store'}).then(r=>r.ok?r.json():null).then(j=>j?.ok===true).catch(()=>false).then(ok=>{onlineAvailable=ok;applyOnline();});}
/** The Blender getaway city, preloaded after the heist assets; the drive falls back to a generated city without it. */
let getawayCity:Object3D|null=null;
function loadGetawayCity(){const loader=new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath(asset('draco/')));loader.loadAsync(asset('heist/getaway-city.glb?v=20261030-city2')).then(g=>{getawayCity=g.scene;}).catch(error=>console.warn('Getaway city unavailable; using the generated city',error));}
let selectedDifficulty:Difficulty='standard';try{const d=localStorage.getItem('laser-difficulty');if(d&&Object.hasOwn(DIFFICULTY,d))selectedDifficulty=d as Difficulty;}catch{}
let mode:'menu'|'practice'|'online'='menu',localId='',selectedLevel=0,selectedRole:Role='infiltrator',socket:WebSocket|null=null,loaded=false,soundTouched=false;
let state:HeistState=createHeistState('DISPLAY','display',roleList.map((role,i)=>({id:`display${i}`,name:ROLES[role].label,role,color:i,x:-3+i*2,z:9,connected:true})));
let view:MuseumView;const audio=new HeistAudio(),navigator=new Navigator();const keys=new Set<string>();let crouch=false,holding=false,takedownTap=false,talkTap=false,route:Point|null=null,expectUnlock=false;
let lastFrame=performance.now(),accumulator=0,lastSend=0,lastUI=0,lastPhase='',lastHost='',lastLevel=0,lastRoster='',lastAlarm=0,lastHacked=false,lastVault=false,lastDiamond=false,lastTalkouts=0,lastConfronted=false,lastTakedowns=0,lastStep=0,guardModes='';
const screen=$('screen'),hud=$('hud');let toastTimer=0;
try{const saved=Number(localStorage.getItem('laser-sensitivity'));if(saved>=8&&saved<=50)$<HTMLInputElement>('sensitivity').value=String(saved);}catch{}
/** Drop any lingering notification when leaving gameplay for a menu or results card. */
function clearToast(){clearTimeout(toastTimer);$('toast').classList.remove('visible');}
function notify(message:string){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=window.setTimeout(()=>$('toast').classList.remove('visible'),4200);}
function active(){return state.players.filter(p=>p.connected);}function player(){return state.players.find(p=>p.id===localId);}
function clearInput(){keys.clear();holding=false;takedownTap=false;route=null;navigator.clear();view?.resetMovement();send({type:'input',x:0,z:0,interact:false,crouch,sprint:false,yaw:view?.yaw||0});}
/** Start audio on the first deliberate click so sound is on by default without autoplay warnings. */
function syncSound(){for(const id of ['sound','pause-sound','settings-sound']){$(id).textContent=audio.enabled?'Sound on':'Sound off';$(id).setAttribute('aria-pressed',String(audio.enabled));}}
function toggleSound(){soundTouched=true;audio.toggle();syncSound();}
function wakeAudio(){if(soundTouched||audio.enabled)return;soundTouched=true;audio.toggle();syncSound();}
function grade(s:HeistState){if(s.phase!=='won')return'F';if(s.alarms===0&&s.talkouts===0&&s.takedowns===0)return'S';if(s.alarms===0)return'A';if(s.alarms<=1)return'B';return'C';}
function accept(next:HeistState){
 const phaseChanged=next.phase!==lastPhase,hostChanged=next.hostId!==lastHost,levelChanged=next.level!==lastLevel;state=next;
 // Only finales count towards the record; setups pay nothing.
 if(phaseChanged&&next.phase==='won'&&next.mission?.kind!=='setup'){const payout=next.payouts.find(p=>p.id===localId)?.amount||0;career=recordClear(career,next.level,payout,next.alarms);try{localStorage.setItem('laser-career-v1',JSON.stringify(career));}catch{}}
 if(next.phase==='playing'){
  if(next.alarms>lastAlarm){notify(next.notice);audio.cue('alarm');document.body.classList.remove('detected');void document.body.offsetWidth;document.body.classList.add('detected');}
  const confronted=!!confrontationFor(next,localId);if(confronted&&!lastConfronted){audio.cue('spotted');clearInput();}lastConfronted=confronted;
  if((next.talkouts??0)>lastTalkouts){notify(next.notice);audio.cue('door');}
  if((next.takedowns??0)>lastTakedowns){notify(next.notice);audio.cue('takedown');}
  const modes=(next.guards??[]).map(g=>g.mode).join();if(modes!==guardModes){const before=guardModes.split(',');(next.guards??[]).forEach((g,i)=>{if(g.mode==='suspicious'&&before[i]==='patrol')audio.cue('suspicious');if(g.mode==='alert'&&before[i]!=='alert')audio.cue('spotted');});guardModes=modes;}
  if(next.hacked&&!lastHacked){audio.cue('door');notify('Entrance open. Work through the marked jobs.');}
  if(next.vaultOpen&&!lastVault){audio.cue('door');notify('Route prepared. Go for the score.');}
  if(next.diamondTaken&&!lastDiamond){audio.cue('loot');notify(next.notice);}
 }
 if(phaseChanged||hostChanged||levelChanged){renderScreen();if(phaseChanged){clearInput();if(next.phase==='playing'){view.resetCamera();view.lockPointer();}else{expectUnlock=true;view.unlockPointer();}if(next.phase==='won')audio.cue('win');if(next.phase==='lost')audio.cue('lose');}}
 lastPhase=next.phase;lastHost=next.hostId;lastLevel=next.level;lastAlarm=next.alarms;lastHacked=next.hacked;lastVault=next.vaultOpen;lastDiamond=next.diamondTaken;lastTalkouts=next.talkouts??0;lastTakedowns=next.takedowns??0;
 if(levelChanged){navigator.clear();lastRoster='';}
}
function contractFacts(i:number){const m=MAPS[i];return[m.guards.length?`${m.guards.length} guard${m.guards.length>1?'s':''}`:'',m.cameras.length?`${m.cameras.length} camera${m.cameras.length>1?'s':''}`:'',`${m.sectors.length} ${i===2?'searchlights':'laser zones'}`].filter(Boolean).join(' · ');}
function menu(){run=null;endGetaway();document.body.classList.remove('board-open','crew-open');crewSelect=null;$<HTMLDialogElement>('pause-menu').close();pauseButton.hidden=true;mode='menu';const old=socket;socket=null;old?.close();localId='';lastPhase='';lastHost='';lastRoster='';clearInput();crouch=false;hud.hidden=true;$('session-label').textContent='STEALTH CO-OP · 1–4 PLAYERS';expectUnlock=true;view?.unlockPointer();
 state=createHeistState('DISPLAY','display',roleList.map((role,i)=>({id:`display${i}`,name:ROLES[role].label,role,color:i,x:-3+i*2,z:9,connected:true})));setHeistLevel(state,selectedLevel);state.guards=[];
 document.body.classList.add('menu-open');
 const m=MAPS[selectedLevel];
 screen.innerHTML=`<section class="menu-hero"><div class="eyebrow">STEALTH CO-OP · 1–4 PLAYERS</div><h1>Stay in the dark.<br><em>Take everything.</em></h1><p>Slip past patrols, duck under laser grids and crack the vault. Three alarms and the building locks down.</p>
 <div class="role-grid" role="group" aria-label="Your role">${roleList.map(r=>`<button class="role-card ${r===selectedRole?'selected':''}" data-practice-role="${r}" aria-pressed="${r===selectedRole}"><span class="eyebrow">${r===selectedRole?'SELECTED':'ROLE'}</span><strong>${ROLES[r].label}</strong><small>${ROLES[r].description}</small><small class="role-job">Crew job here: ${esc(crewJobs(selectedLevel).find(o=>o.role===r)?.label??'—')}</small></button>`).join('')}</div></section>
 <aside class="menu-panel">${campaign.finished?`<div class="complete-badge">CAMPAIGN COMPLETE · ${money(campaign.money)} BANKED</div>`:''}<div class="eyebrow muted">CONTRACTS</div><div class="contract-list">${MAPS.map((item,i)=>{const locked=i>campaign.unlocked;return`<button data-contract="${i}" class="contract ${i===selectedLevel?'selected':''} ${locked?'locked':''}" aria-pressed="${i===selectedLevel}"><span class="num">0${i+1}</span><span class="name"><strong>${esc(HEISTS[i].codename)}</strong><small>${esc(item.name)} · ${contractFacts(i)}</small></span><span class="best">${locked?'LOCKED':campaign.plans[i].best?money(campaign.plans[i].best):'—'}</span></button>`;}).join('')}</div>
 <div class="difficulty-picker"><div class="eyebrow muted">DIFFICULTY</div><div class="segmented" role="group" aria-label="Difficulty">${(Object.keys(DIFFICULTY) as Difficulty[]).map(d=>`<button data-difficulty="${d}" class="${d===selectedDifficulty?'selected':''}" aria-pressed="${d===selectedDifficulty}">${DIFFICULTY[d].label}</button>`).join('')}</div><small id="difficulty-blurb">${DIFFICULTY[selectedDifficulty].blurb}</small></div>
 <div class="stat-grid"><div><small>TIME</small><strong>${timeText(Math.round(m.time*DIFFICULTY[selectedDifficulty].time))}</strong></div><div><small>TAKE</small><strong class="gold">${money(m.loot)}</strong></div><div><small>ACCOUNT</small><strong class="gold">${money(campaign.money)}</strong></div></div>
 <div class="menu-actions"><button id="practice" class="cta" ${loaded&&selectedLevel<=campaign.unlocked?'':'disabled'}><span>${selectedLevel<=campaign.unlocked?'PLAN THE HEIST':`LOCKED · FINISH 0${selectedLevel} FIRST`}</span><span>→</span></button><button id="preview" class="ghost-btn" ${loaded?'':'disabled'}>Practice — no guards, no clock</button></div>
 <form id="entry-form" class="online"><div class="eyebrow muted">PLAY ONLINE</div><div class="row"><label class="sr" for="alias">Your alias</label><input id="alias" maxlength="18" autocomplete="nickname" placeholder="Your alias" required value="${esc(sessionStorage.getItem('heist-name')||'')}"><button id="create" class="ghost-btn" ${loaded?'':'disabled'}>Create room</button></div><div class="row"><label class="sr" for="code">Room code</label><input id="code" placeholder="ROOM CODE" maxlength="5" class="mono"><button type="button" id="join" class="ghost-btn" ${loaded?'':'disabled'}>Join</button></div></form>
 <p class="fine">${career.cleanRuns} clean runs · ${money(career.earnings)} earned on this browser · fictional currency</p></aside>`;
 $('entry-form').onsubmit=e=>{e.preventDefault();wakeAudio();connect(false);};$('join').onclick=()=>{wakeAudio();connect(true);};$('practice').onclick=()=>{wakeAudio();openBoard(selectedLevel);};$('preview').onclick=()=>{wakeAudio();practice(selectedLevel,true);};
 document.querySelectorAll<HTMLButtonElement>('[data-practice-role]').forEach(b=>b.onclick=()=>{selectedRole=b.dataset.practiceRole as Role;document.querySelectorAll<HTMLButtonElement>('[data-practice-role]').forEach(item=>{const chosen=item.dataset.practiceRole===selectedRole;item.classList.toggle('selected',chosen);item.setAttribute('aria-pressed',String(chosen));item.querySelector('.eyebrow')!.textContent=chosen?'SELECTED':'ROLE';});});
 document.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach(b=>b.onclick=()=>{selectedDifficulty=b.dataset.difficulty as Difficulty;try{localStorage.setItem('laser-difficulty',selectedDifficulty);}catch{}const alias=$<HTMLInputElement>('alias').value,codeValue=$<HTMLInputElement>('code').value;menu();$<HTMLInputElement>('alias').value=alias;$<HTMLInputElement>('code').value=codeValue;});
 document.querySelectorAll<HTMLButtonElement>('[data-contract]').forEach(b=>b.onclick=()=>{const alias=$<HTMLInputElement>('alias').value,codeValue=$<HTMLInputElement>('code').value;selectedLevel=Number(b.dataset.contract);menu();$<HTMLInputElement>('alias').value=alias;$<HTMLInputElement>('code').value=codeValue;});const code=new URL(location.href).searchParams.get('room');if(code)$<HTMLInputElement>('code').value=code.toUpperCase();applyOnline();
}
function nameInput(){const el=$<HTMLInputElement>('alias'),name=el.value.trim().normalize('NFKC');if(!name||name.length>18||/[<>\[\]{}\p{C}]/u.test(name)){el.setCustomValidity('Use 1–18 letters, numbers or spaces.');el.reportValidity();el.oninput=()=>el.setCustomValidity('');return null;}sessionStorage.setItem('heist-name',name);return name;}
function send(data:unknown){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data));}
function connect(join:boolean){const name=nameInput();if(!name)return;const code=$<HTMLInputElement>('code').value.trim().toUpperCase();if(join&&!/^[A-Z0-9]{5}$/.test(code)){notify('Enter the five-character room code.');return;}const prior=socket;socket=null;prior?.close();const ws=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/heist/ws`);socket=ws;let welcomed=false;notify('Calling your crew…');const timeout=setTimeout(()=>{if(!welcomed&&socket===ws){ws.close();notify('The room server could not be reached. Solo play still works.');}},8000);
 ws.onopen=()=>{if(socket!==ws){ws.close();return;}ws.send(JSON.stringify(join?{type:'join',name,code}:{type:'create',name}));};ws.onmessage=e=>{if(socket!==ws)return;const msg=JSON.parse(e.data) as HeistServerMessage;if(msg.type==='welcome'){welcomed=true;clearTimeout(timeout);localId=msg.id;mode='online';lastPhase='';lastRoster='';lastAlarm=0;lastTalkouts=0;lastConfronted=false;lastTakedowns=0;lastHacked=false;lastVault=false;lastDiamond=false;if(!join&&selectedLevel)send({type:'level',level:selectedLevel});if(!join&&selectedDifficulty!=='standard')send({type:'difficulty',difficulty:selectedDifficulty});if(!join)send({type:'role',role:selectedRole});}else if(msg.type==='state')accept(msg.state);else{notify(msg.message);if(!welcomed)ws.close();}};
 ws.onerror=()=>{if(socket===ws)notify('Connection unavailable. You can still play solo.');};ws.onclose=()=>{clearTimeout(timeout);if(socket===ws&&mode==='online'){menu();notify('The room connection ended. Join a new crew to continue.');}};
}
function practice(level:number,preview=false,prepare?:(s:HeistState)=>string){const old=socket;socket=null;old?.close();mode='practice';localId='you';crouch=false;lastPhase='';lastRoster='';lastAlarm=0;lastTalkouts=0;lastConfronted=false;lastTakedowns=0;guardModes='';lastHacked=false;lastVault=false;lastDiamond=false;route=null;navigator.clear();
 const name=sessionStorage.getItem('heist-name')||'You';state=createHeistState('SOLO','you',[{id:'you',name,role:selectedRole,color:0,connected:true}]);setHeistLevel(state,level);state.difficulty=preview?'standard':selectedDifficulty;startHeist(state);state.practice=preview;if(preview)state.guards=[];const brief=prepare?.(state);accept(state);notify(brief??(preview?'Practice: no guards, no clock. Learn the route.':'Guards are on patrol. Stay out of their light.'));}

let crewSelect:CrewSelect|null=null;
async function copyInvite(){try{const u=new URL(location.href);u.searchParams.set('room',state.code);await window.navigator.clipboard.writeText(u.href);notify('Invite copied. Send it to your crew.');}catch{notify(`Share room code ${state.code}`);}}
function renderScreen(){if(mode==='menu')return;document.body.classList.remove('menu-open');document.body.classList.toggle('crew-open',state.phase==='lobby');if(state.phase!=='lobby')crewSelect=null;const playing=state.phase==='playing';pauseButton.hidden=!playing;if(!playing)$<HTMLDialogElement>('pause-menu').close();hud.hidden=!playing;screen.innerHTML='';$('session-label').textContent=mode==='practice'?(state.practice?'PRACTICE':'SOLO'):`PRIVATE CREW · ${state.code}`;
 if(state.phase==='lobby'){
  // The room's crew-select screen: pick a role, read what it does, agree the split and ready up.
  document.body.classList.add('crew-open');screen.innerHTML='<section id="crew-select" class="crew-select"></section>';
  crewSelect=new CrewSelect($('crew-select'),{role:role=>send({type:'role',role}),ready:ready=>send({type:'ready',ready}),start:()=>send({type:'start'}),level:level=>send({type:'level',level}),difficulty:difficulty=>send({type:'difficulty',difficulty}),cuts:cuts=>send({type:'cuts',cuts}),invite:copyInvite,leave:menu,help:()=>$('help').click(),sound:()=>{$('sound').click();return $('sound').textContent??'';},soundLabel:()=>$('sound').textContent??''});
  crewSelect.update(state,localId,true);
 }else if(state.phase==='won'||state.phase==='lost'){
  if(run){campaignResult();return;}
  const won=state.phase==='won',g=grade(state),m=MAPS[state.level];
  const extras=m.objectives.filter(o=>o.optional&&o.bonus);const used=m.time-state.remaining;
  const bonuses=[...(won&&state.alarms===0?[[`Ghost — no alarms raised`,'CLEAN']]:[]),...extras.map(o=>[o.label.replace('Optional ',''),state.completed.includes(o.id)?'+ '+money(o.bonus!):'—']),...(won&&state.talkouts>0?[[`Talked past ${state.talkouts} guard${state.talkouts>1?'s':''}`,'SMOOTH']]:[])];
  screen.innerHTML=`<section class="card debrief"><div class="debrief-head"><div><div class="eyebrow ${won?'ok':'bad'}">${won?'CONTRACT COMPLETE · CREW EXTRACTED':state.busted?'COVER BLOWN':'CONTRACT FAILED'}${state.practice?'':' · '+DIFFICULTY[state.difficulty].label.toUpperCase()}</div><h2>${won?(g==='S'?'Like you were never there.':g==='A'?'Clean getaway.':'Out with the score.'):state.busted?'Busted.':'Lockdown.'}</h2>${won?'':`<p>${esc(state.notice)}</p>`}</div><div class="grade grade-${g}" aria-label="Grade ${g}">${g}</div></div>
  <div class="stat-grid four"><div><small>TAKE</small><strong class="gold">${money(won?state.securedValue:0)}</strong></div><div><small>TIME</small><strong>${state.practice?'—':timeText(used)}</strong></div><div><small>ALARMS</small><strong>${state.alarms} / ${state.maxAlarms}</strong></div><div><small>TAKEDOWNS</small><strong>${state.takedowns}</strong></div></div>
  ${bonuses.length?`<div class="bonus-list"><div class="eyebrow muted">BONUSES</div>${bonuses.map(([a,b])=>`<div><span>${esc(a)}</span><span class="${b==='—'?'':'ok'}">${esc(b)}</span></div>`).join('')}</div>`:''}
  ${crewJobs(state.level).some(o=>state.completed.includes(o.id))?`<div class="bonus-list"><div class="eyebrow muted">CREW JOBS</div>${crewJobs(state.level).filter(o=>state.completed.includes(o.id)).map(o=>`<div><span>${ROLES[o.role!].number} ${esc(o.label)}</span><span class="ok">${esc(state.players.find(p=>p.id===state.credits?.[o.id])?.name??ROLE_NAMES[o.role!])}</span></div>`).join('')}</div>`:''}
  ${state.payouts.length>1?`<div class="bonus-list"><div class="eyebrow muted">CREW SPLIT</div>${state.payouts.map(p=>`<div><span>${esc(p.name)} · ${p.cut}%</span><span class="gold">${money(won?p.amount:0)}</span></div>`).join('')}</div>`:''}
  <div class="debrief-actions">${won&&state.level<2?'<button id="next-contract" class="cta"><span>NEXT CONTRACT</span><span>→</span></button>':''}<button id="retry" class="${won&&state.level<2?'ghost-btn':'cta'}">${won?'Run it again':'<span>TRY AGAIN</span><span>↻</span>'}</button><button id="result-home" class="ghost-btn">Menu</button></div></section>`;
  $('retry').onclick=()=>mode==='practice'?practice(state.level,state.practice):send({type:'restart'});if($('next-contract'))$('next-contract').onclick=()=>{if(mode==='practice'){const old=state;nextHeist(old);startHeist(old);selectedLevel=old.level;lastPhase='';lastRoster='';crouch=false;accept(old);}else send({type:'next'});};$('result-home').onclick=menu;updateResult();
 }
}
// ─── Heist campaign: planning board, setups, finale, getaway, payout ────────────────────────────
const planFor=(level:number)=>campaign.plans[level];
function crewCut(level:number){const plan=planFor(level),heist=HEISTS[level],approach=heist.approaches.find(a=>a.id===plan.approach)!;return(crewById(plan.hacker)?.cut??0)+(heist.getaway==='van'?crewById(plan.driver)?.cut??0:0)+(approach.mods.extraCut??0);}
function openBoard(level:number){clearToast();selectedLevel=level;mode='menu';run=null;document.body.classList.remove('menu-open');document.body.classList.add('board-open');hud.hidden=true;renderBoard();}
function renderBoard(){
 const level=selectedLevel,heist=HEISTS[level],plan=planFor(level),approach=heist.approaches.find(a=>a.id===plan.approach)!,m=MAPS[level];
 const required=setupById(heist,approach.setup),ready=finaleReady(heist,plan.approach,plan.setups),cut=crewCut(level);
 const status=(id:string)=>plan.setups.includes(id)?['done','DONE']:id===heist.casing?['optional','OPTIONAL']:id===approach.setup?['required','REQUIRED']:['other','OTHER APPROACH'];
 const crewCard=(role:'hacker'|'driver')=>CREW.filter(c=>c.role===role).map(c=>`<button class="crew-card ${plan[role]===c.id?'selected':''}" data-crew="${role}:${c.id}" aria-pressed="${plan[role]===c.id}"><span class="stars" aria-label="Skill ${c.skill} of 3">${'●'.repeat(c.skill)}${'○'.repeat(3-c.skill)}</span><strong>${esc(c.name)}</strong><small>${esc(c.perk)}</small><span class="cut">${c.cut}% cut</span></button>`).join('');
 screen.innerHTML=`<section class="board"><header class="board-head"><button id="board-back" class="text-btn">← All heists</button><div class="board-title"><div class="eyebrow">HEIST 0${level+1} · ${esc(m.name.toUpperCase())}</div><h1>${esc(heist.codename)}</h1><p>${esc(heist.pitch)}</p></div><div class="board-account"><small>ACCOUNT</small><strong class="gold">${money(campaign.money)}</strong></div></header>
 <div class="board-grid">
  <section class="board-col"><div class="eyebrow muted">1 · CHOOSE THE APPROACH</div>${heist.approaches.map(a=>`<button class="approach ${a.id===plan.approach?'selected':''}" data-approach="${a.id}" aria-pressed="${a.id===plan.approach}"><strong>${esc(a.name)}</strong><small>${esc(a.pitch)}</small><span class="needs">Needs: ${esc(setupById(heist,a.setup).name)}${plan.setups.includes(a.setup)?' ✓':''}</span></button>`).join('')}</section>
  <section class="board-col"><div class="eyebrow muted">2 · RUN THE SETUPS</div>${heist.setups.map(s=>{const[cls,label]=status(s.id);return`<div class="setup-row ${cls}"><span class="pill">${label}</span><strong>${esc(s.name)}</strong><small>${esc(s.reward)}</small><button class="ghost-btn" data-setup="${s.id}">${plan.setups.includes(s.id)?'Replay':'Play setup'}</button></div>`;}).join('')}</section>
  <section class="board-col"><div class="eyebrow muted">3 · HIRE THE CREW</div><div class="crew-role">HACKER</div><div class="crew-row-cards">${crewCard('hacker')}</div><div class="crew-role">${heist.getaway==='van'?'GETAWAY DRIVER':'PILOT'}</div>${heist.getaway==='van'?`<div class="crew-row-cards">${crewCard('driver')}</div>`:'<p class="fine">The helicopter pilot comes with the job — no cut.</p>'}</section>
 </div>
 <footer class="board-foot"><div class="stat-grid four"><div><small>POTENTIAL TAKE</small><strong class="gold">${money(m.loot)}</strong></div><div><small>CREW CUTS</small><strong>${cut}%</strong></div><div><small>YOUR SHARE</small><strong class="gold">${money(m.loot*(100-cut)/100)}</strong></div><div><small>DIFFICULTY</small><strong>${DIFFICULTY[selectedDifficulty].label}</strong></div></div><button id="start-finale" class="cta" ${ready?'':'disabled'}><span>${ready?'START THE FINALE':`RUN “${esc(required.name.toUpperCase())}” FIRST`}</span><span>→</span></button></footer></section>`;
 $('board-back').onclick=menu;
 document.querySelectorAll<HTMLButtonElement>('[data-approach]').forEach(b=>b.onclick=()=>{plan.approach=b.dataset.approach!;saveCampaign(campaign);renderBoard();});
 document.querySelectorAll<HTMLButtonElement>('[data-crew]').forEach(b=>b.onclick=()=>{const[role,id]=b.dataset.crew!.split(':') as ['hacker'|'driver',string];plan[role]=id;saveCampaign(campaign);renderBoard();});
 document.querySelectorAll<HTMLButtonElement>('[data-setup]').forEach(b=>b.onclick=()=>{wakeAudio();startCampaign(level,'setup',b.dataset.setup);});
 $('start-finale').onclick=()=>{wakeAudio();startCampaign(level,'finale');};
}
function startCampaign(level:number,kind:'setup'|'finale',setupId?:string){
 const heist=HEISTS[level],plan=planFor(level);document.body.classList.remove('board-open');
 run={level,kind,setupId};
 practice(level,false,s=>{
  if(kind==='setup'){const setup=setupById(heist,setupId!);startSetup(s,setup);return`Setup: ${setup.brief}`;}
  const mods=finaleMods(heist,plan.approach,plan.setups,[plan.hacker,plan.driver]);applyFinaleMods(s,mods);
  const perks=[mods.blackout?`cameras looped for ${mods.blackout}s`:'',mods.preComplete?.length?`${mods.preComplete.length} job${mods.preComplete.length>1?'s':''} already done`:'',mods.suspicion&&mods.suspicion<1?'guards slower to suspect you':'',mods.time?`+${mods.time}s on the clock`:''].filter(Boolean);
  return`Finale: ${heist.approaches.find(a=>a.id===plan.approach)!.name}${perks.length?' — '+perks.join(', '):''}.`;
 });
}
function campaignResult(){
 clearToast();
 const r=run!,heist=HEISTS[r.level],plan=planFor(r.level),won=state.phase==='won';
 hud.hidden=true;
 if(r.kind==='setup'){
  const setup=setupById(heist,r.setupId!);
  if(won&&!plan.setups.includes(setup.id)){plan.setups.push(setup.id);saveCampaign(campaign);}
  screen.innerHTML=`<section class="card debrief"><div class="eyebrow ${won?'ok':'bad'}">${won?'SETUP COMPLETE':'SETUP FAILED'} · ${esc(heist.codename.toUpperCase())}</div><h2>${won?esc(setup.name)+' — done.':state.busted?'Busted.':'Out of time.'}</h2><p>${won?esc(setup.reward):esc(state.notice)}</p><div class="debrief-actions">${won?'':'<button id="retry" class="cta"><span>TRY AGAIN</span><span>↻</span></button>'}<button id="to-board" class="${won?'cta':'ghost-btn'}">${won?'<span>BACK TO THE BOARD</span><span>→</span>':'Heist board'}</button></div></section>`;
 }else if(won&&heist.getaway==='van'){startGetaway(state.securedValue);return;}
 else if(won){payout(state.securedValue,'The helicopter lifts the crew clear of the tower.');return;}
 else screen.innerHTML=`<section class="card debrief"><div class="eyebrow bad">FINALE FAILED · ${esc(heist.codename.toUpperCase())}</div><h2>${state.busted?'Busted.':'Lockdown.'}</h2><p>${esc(state.notice)} Your setups still count — try the finale again.</p><div class="debrief-actions"><button id="retry" class="cta"><span>RETRY THE FINALE</span><span>↻</span></button><button id="to-board" class="ghost-btn">Heist board</button></div></section>`;
 if($('retry'))$('retry').onclick=()=>startCampaign(r.level,r.kind,r.setupId);
 $('to-board').onclick=()=>openBoard(r.level);
}
function startGetaway(take:number){
 endGetaway();expectUnlock=true;view.unlockPointer();hud.hidden=true;screen.innerHTML='';clearInput();
 const driver=crewById(planFor(run!.level).driver)??CREW.find(c=>c.role==='driver')!;
 // Wanted level: one star plus one per alarm raised in the finale; Relaxed starts a star lower, Pro a star higher.
 const stars=Math.max(1,Math.min(5,1+state.alarms+(state.difficulty==='relaxed'?-1:state.difficulty==='pro'?1:0)));
 getaway={sim:createGetaway({top:driver.top!,grip:driver.grip!,stars}),view:new GetawayView(view.renderer,ui,(k,down)=>{if(down)keys.add(k);else keys.delete(k);},getawayCity),acc:0,take,outro:null,before:null};document.body.classList.add('driving');audio.startDrive();
 audio.cue('alarm');notify(`${driver.name} floors it. ${stars} star${stars>1?'s':''} — lose the cops, then get to the drop-off.`);
}
function driveGetaway(dt:number,now:number){
 const g=getaway!,k=(...names:string[])=>names.some(n=>keys.has(n)),paused=$<HTMLDialogElement>('pause-menu').open;
 // Fixed 60 Hz steps; remember the hardest hit across them for the crash sound and camera kick.
 let hit=0;
 if(!paused){g.acc+=dt;while(g.acc>=1/60){g.before=poseSnapshot(g.sim);stepGetaway(g.sim,{up:k('w','arrowup'),down:k('s','arrowdown'),left:k('a','arrowleft'),right:k('d','arrowright'),brake:k(' ')},1/60);hit=Math.max(hit,g.sim.impact);g.acc-=1/60;}}
 g.sim.impact=hit;if(hit>4)audio.crash(hit);
 const v=g.sim.van;audio.setDrive(paused||g.outro!==null?0:Math.hypot(v.vx,v.vz),paused||!g.sim.wanted?0:Math.max(0,1-g.view.nearestCop(g.sim)/90));
 // Draw between the last two physics steps so motion stays smooth on any refresh rate.
 g.view.draw(g.sim,paused?0:dt,now,Math.min(1,g.acc*60),g.before,(k('a','arrowleft')?1:0)-(k('d','arrowright')?1:0));
 if(g.sim.notice!==lastNotice){lastNotice=g.sim.notice;if(g.sim.phase==='escape')notify(g.sim.notice);}
 if(g.sim.phase==='escape')return;
 // A short beat on the result before the debrief card: garage door up, or BUSTED.
 if(g.outro===null){
  g.outro=g.sim.phase==='won'?2.8:2.2;audio.setDrive(0,0);
  if(g.sim.phase==='won'){g.view.openGarage();g.view.banner('MADE IT','The score is home. Lock the door.','ok');audio.cue('win');}
  else{g.view.banner(g.sim.phase==='wrecked'?'WRECKED':'BUSTED',g.sim.notice,'bad');audio.cue('lose');}
 }
 g.outro-=dt;if(g.outro>0)return;
 const result=g.sim.phase,take=g.take;endGetaway();
 if(result==='won'){payout(take,'The van rolls into the getaway house. Garage door down. Clean drop.');return;}
 screen.innerHTML=`<section class="card debrief"><div class="eyebrow bad">GETAWAY FAILED · ${esc(HEISTS[run!.level].codename.toUpperCase())}</div><h2>${result==='wrecked'?'The van is wrecked.':'Busted.'}</h2><p>The score was in the back. Take the wheel again from the loading dock.</p><div class="debrief-actions"><button id="retry-drive" class="cta"><span>RETRY THE GETAWAY</span><span>↻</span></button><button id="to-board" class="ghost-btn">Heist board</button></div></section>`;
 $('retry-drive').onclick=()=>{screen.innerHTML='';startGetaway(take);};$('to-board').onclick=()=>openBoard(run!.level);
}
/** The campaign's last screen, shown after the final heist is cleared for the first time. */
function showEnding(){
 run=null;mode='menu';hud.hidden=true;document.body.classList.add('menu-open');clearToast();$('session-label').textContent='CAMPAIGN COMPLETE';
 const scores=HEISTS.map((h,i)=>`<div><span>${esc(h.codename)}</span><span class="gold">${money(campaign.plans[i].best)}</span></div>`).join('');
 screen.innerHTML=`<section class="card debrief ending"><div class="eyebrow ok">THE AFTER HOURS CREW · CAMPAIGN COMPLETE</div><h2>Three scores. One crew.</h2>
 <p>The museum's centrepiece, a vault of bullion and a power core from the top of the city — and the getaway house is still a secret. The crew splits the take, burns the plans and goes quiet. For now.</p>
 <div class="stat-grid four"><div><small>ACCOUNT</small><strong class="gold">${money(campaign.money)}</strong></div><div><small>SCORES PULLED</small><strong>${campaign.plans.reduce((a,p)=>a+p.scores,0)}</strong></div><div><small>CLEAN RUNS</small><strong>${career.cleanRuns}</strong></div><div><small>DIFFICULTY</small><strong>${DIFFICULTY[selectedDifficulty].label}</strong></div></div>
 <div class="bonus-list"><div class="eyebrow muted">BEST SHARE PER HEIST</div>${scores}</div>
 <div class="credits"><div class="eyebrow muted">CREDITS</div><p>Design, code, Blender environments and getaway city built for Laser Heist. Crew character based on Quaternius's CC0 Universal Base Characters and Animation Library. Rendering by three.js. Every heist can be replayed from its board — try Professional.</p></div>
 <div class="debrief-actions"><button id="ending-menu" class="cta"><span>BACK TO THE MENU</span><span>→</span></button><button id="ending-board" class="ghost-btn">Replay a heist</button></div></section>`;
 $('ending-menu').onclick=menu;$('ending-board').onclick=()=>openBoard(0);
}
function endGetaway(){document.body.classList.remove('driving');audio.stopDrive();if(!getaway)return;getaway.view.dispose();getaway=null;}
function payout(take:number,line:string){
 clearToast();
 const level=run!.level,heist=HEISTS[level],plan=planFor(level),approach=heist.approaches.find(a=>a.id===plan.approach)!;
 const cuts=[{name:crewById(plan.hacker)!.name+' · hacker',pct:crewById(plan.hacker)!.cut},...(heist.getaway==='van'?[{name:crewById(plan.driver)!.name+' · driver',pct:crewById(plan.driver)!.cut}]:[]),...(approach.mods.extraCut?[{name:'Night manager · inside man',pct:approach.mods.extraCut}]:[])];
 const paid=cuts.map(c=>({...c,amount:Math.floor(take*c.pct/100)})),share=take-paid.reduce((a,c)=>a+c.amount,0);
 campaign.money+=share;plan.best=Math.max(plan.best,share);plan.scores+=1;plan.setups=[];
 const unlockedNow=level===campaign.unlocked&&level<HEISTS.length-1;if(unlockedNow)campaign.unlocked+=1;
 const finishedNow=level===HEISTS.length-1&&!campaign.finished;if(finishedNow)campaign.finished=true;saveCampaign(campaign);
 const g=grade(state);
 screen.innerHTML=`<section class="card debrief"><div class="debrief-head"><div><div class="eyebrow ok">SCORE SECURED · ${esc(heist.codename.toUpperCase())}</div><h2>${g==='S'?'Ghosts.':g==='A'?'Clean getaway.':'You got paid.'}</h2><p>${esc(line)}</p></div><div class="grade grade-${g}" aria-label="Grade ${g}">${g}</div></div>
 <div class="bonus-list"><div class="eyebrow muted">THE SPLIT</div><div><span>Take</span><span class="gold">${money(take)}</span></div>${paid.map(c=>`<div><span>${esc(c.name)} · ${c.pct}%</span><span>− ${money(c.amount)}</span></div>`).join('')}<div class="total"><span>Your share</span><span class="gold">${money(share)}</span></div></div>
 <div class="stat-grid four"><div><small>ACCOUNT</small><strong class="gold">${money(campaign.money)}</strong></div><div><small>ALARMS</small><strong>${state.alarms} / ${state.maxAlarms}</strong></div><div><small>BLUFFS</small><strong>${state.talkouts}</strong></div><div><small>TAKEDOWNS</small><strong>${state.takedowns}</strong></div></div>
 ${unlockedNow?`<p class="unlock">New heist unlocked: <strong>${esc(HEISTS[level+1].codename)}</strong></p>`:''}
 <div class="debrief-actions">${finishedNow?'<button id="ending" class="cta"><span>SEE THE ENDING</span><span>→</span></button>':level<HEISTS.length-1?'<button id="next-heist" class="cta"><span>NEXT HEIST</span><span>→</span></button>':''}<button id="to-board" class="${level<HEISTS.length-1||finishedNow?'ghost-btn':'cta'}">Heist board</button><button id="to-menu" class="ghost-btn">Menu</button></div></section>`;
 if($('next-heist'))$('next-heist').onclick=()=>openBoard(level+1);
 if($('ending'))$('ending').onclick=showEnding;
 $('to-board').onclick=()=>openBoard(level);$('to-menu').onclick=menu;
}
function updateResult(){if(!['won','lost'].includes(state.phase))return;for(const id of ['retry','next-contract']){const b=$<HTMLButtonElement>(id);if(b)b.disabled=mode==='online'&&state.hostId!==localId;}}
function updateLobby(){if(state.phase!=='lobby'||mode!=='online')return;crewSelect?.update(state,localId);}
const STAGE_TITLES={infiltrate:'Get inside.',override:'Prepare the route.',loot:'Take the score.',escape:'Get everyone out.'};
function objectiveItems(){const m=MAPS[state.level];if(state.mission?.kind==='setup'){const t=state.mission.targets;return[...t.map(x=>({label:x.label,state:x.done?'done':'open'})),{label:'Get back out to the entry point',state:t.every(x=>x.done)?'open':'locked'}];}if(state.diamondTaken)return[{label:m.cargo==='cart'?'Drive the cart to the van — hold E, release to brake':'Carry the loot along the dashed route',state:'open'},{label:'Whole crew inside the extraction ring',state:'open'}];
 const required=m.objectives.filter(o=>!o.optional&&o.kind!=='security');const open=new Set(currentJobs(state).map(o=>o.id));
 return required.filter(o=>!(o.release&&state.completed.includes(o.release))).map(o=>({label:o.label+(o.kind==='hold'?(state.clamps[o.id]?.installed?' · clamped':' · hold 6s to clamp'):''),state:state.completed.includes(o.id)?'done':open.has(o.id)||state.clamps[o.id]?.installed?'open':'locked'})).sort((a,b)=>({open:0,locked:1,done:2}[a.state]!-{open:0,locked:1,done:2}[b.state]!)).slice(0,5);}
function updateHUD(){if(mode==='menu')return;if(state.phase==='lobby'){updateLobby();return;}if(state.phase!=='playing'){updateResult();return;}const me=player();if(!me)return;
 $('contract-label').textContent=`0${state.level+1} · ${run?HEISTS[state.level].codename.toUpperCase()+(run.kind==='setup'?' · SETUP':' · FINALE'):MAPS[state.level].name.toUpperCase()}${state.practice?'':' · '+DIFFICULTY[state.difficulty].label.toUpperCase()}`;
 $('objective-title').textContent=state.mission?.kind==='setup'?state.mission.name+'.':STAGE_TITLES[state.missionStage];
 $('objective-list').innerHTML=objectiveItems().map(i=>`<li class="${i.state}"><i></i><span>${esc(i.label)}</span></li>`).join('');
 // Crew jobs for the roles on this crew: yours first, then whoever has done theirs.
 const roles=new Set(active().map(p=>p.role)),jobs=state.mission?.kind==='setup'?[]:crewJobs(state.level).filter(o=>roles.has(o.role!)).sort((a,b)=>Number(b.role===me.role)-Number(a.role===me.role));
 $('crew-jobs').hidden=!jobs.length;$('crew-jobs').innerHTML=`<div class="eyebrow muted">CREW JOBS · OPTIONAL</div>`+jobs.map(o=>{const done=state.completed.includes(o.id),by=state.players.find(p=>p.id===state.credits?.[o.id]);return`<div class="crew-job ${done?'done':''} ${o.role===me.role?'mine':''}"><b>${ROLES[o.role!].number}</b><span>${esc(o.label)}</span><em>${done?(by?.id===localId?'You ✓':esc(by?.name??'Done')+' ✓'):o.role===me.role?'YOUR JOB':ROLE_NAMES[o.role!]}</em></div>`;}).join('');
 $('clock').textContent=state.practice?'PRACTICE':state.recovery>0?'RECOVERY':timeText(state.remaining);$('clock').classList.toggle('urgent',!state.practice&&state.remaining<40);$('take').textContent=money(state.lootValue);
 $('alarm-pips').innerHTML=Array.from({length:state.maxAlarms??3},(_,i)=>`<i class="${i<state.alarms?'on':''}"></i>`).join('');
 const crew=active();$('crew-count').textContent=`${crew.length} / ${crew.length}`;
 $('crew-list').innerHTML=crew.map(p=>`<div class="crew-chip"><i style="background:${COLORS[p.color%4]}"></i><span>${esc(p.id===localId?'You':p.name)}</span><small>${p.carrying?'Carrying loot':state.jobs[p.id]?esc(state.jobs[p.id]):ROLES[p.role].label}</small></div>`).join('');
 // Awareness: how hard any guard is looking at me right now.
 let exposure=0,hunted=!!confrontationFor(state,me.id),seen=false,watcher:{x:number;z:number}|null=null;for(const g of state.guards??[]){const v=guardVisibility(state,g,me);if(v>0||g.suspicion>.02&&g.lastSeen){if(v>0)seen=true;const level=g.mode==='confront'&&g.target===me.id?1:g.suspicion;if(level>exposure){exposure=level;watcher=g;}}}
 // Suspicion circle around the crosshair; its arrow points at whoever is watching.
 const fill=$('detect-fill');fill.style.strokeDashoffset=String(100-exposure*100);$('detect').classList.toggle('active',exposure>.02);$('detect').classList.toggle('danger',exposure>.7||hunted);
 if(watcher){const dx=watcher.x-me.x,dz=watcher.z-me.z,yaw=view.yaw;const right=dx*Math.cos(yaw)-dz*Math.sin(yaw),ahead=-dx*Math.sin(yaw)-dz*Math.cos(yaw);$('detect-arrow').style.transform=`rotate(${Math.atan2(right,ahead)}rad)`;}
 $('vignette').style.opacity=String(hunted?.95:Math.min(.8,exposure*.85));$('vignette').classList.toggle('hunted',hunted);audio.setTension(hunted?1:exposure);
 const status=hunted?'STOPPED — BLUFF':seen?'SEEN':me.crouching?'HIDDEN · CROUCHED':'HIDDEN';$('stance').textContent=status;$('stance').className=hunted?'bad':seen?'warn':'ok';
 $('op-role').textContent=ROLES[me.role].label.toUpperCase();
 const stamina=me.stamina??1;$('stamina-pct').textContent=me.exhausted?'WINDED':`${Math.round(stamina*100)}%`;$('stamina-bar').style.width=`${stamina*100}%`;$('stamina-bar').classList.toggle('winded',!!me.exhausted);
 const noise=me.noise??0,lit=noise>=1?5:noise>=.6?4:noise>=.35?3:noise>0?2:me.crouching?0:1;$('noise-label').textContent=noise>=1?'LOUD':noise>=.35?'AUDIBLE':noise>0?'SOFT':'SILENT';document.querySelectorAll('#noise-segments i').forEach((el,i)=>el.classList.toggle('on',i<lit));$('noise-segments').dataset.level=noise>=1?'loud':'quiet';
 const target=takedownTarget(state,me);const info=interactionHint(state,me);
 const text=target?'Take down guard':info.text.replace(/^(Hold E|Press C) · /,'');const key=target?'F':/^Hold E/.test(info.text)?'E':/^Press C/.test(info.text)?'C':/^M ·/.test(info.text)?'':'';
 const showPrompt=!!target||!!text&&!/^M ·/.test(info.text);$('action-prompt').hidden=!showPrompt;$('action-key').textContent=key;$('action-text').textContent=target?text:(key?(key==='E'?'Hold · ':'')+text:text);
 ($('hold-meter').firstElementChild as HTMLElement).style.width=`${info.progress*100}%`;$('hold-meter').hidden=info.progress<=0||!!target;
 $('lock-hint').hidden=view.locked||hunted||!matchMedia('(pointer:fine)').matches||!!document.querySelector('dialog[open]');
 $('touch-crouch').textContent=crouch?'Stand':'Crouch';$('touch-takedown').hidden=!target;drawMap($<HTMLCanvasElement>('mini-map'));if($<HTMLDialogElement>('tactical').open)drawMap($<HTMLCanvasElement>('big-map'));
}
function drawMap(canvas:HTMLCanvasElement){drawFloorPlan(canvas,state,localId,COLORS,route);}
function modalOpen(){return!!document.querySelector('dialog[open]');}
function readInput(now:number):HeistInput{const x=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0),y=(keys.has('w')||keys.has('arrowup')?1:0)-(keys.has('s')||keys.has('arrowdown')?1:0);const modal=modalOpen();if(modal)view.resetMovement();let move=modal?{x:0,z:0}:view.movement(x,y);const me=player();if(x||y)route=null;if(route&&me&&!modal){const copy={...me,crouching:crouch};move=navigator.steer(state,copy,route,now);if(Math.hypot(me.x-route.x,me.z-route.z)<.55)route=null;}
 const takedown=!modal&&(keys.has('f')||takedownTap);const c=confrontationFor(state,localId);return{x:modal?0:move.x,z:modal?0:move.z,interact:!modal&&(holding||keys.has('e')),crouch,sprint:keys.has('shift'),yaw:view.yaw,takedown,talk:keys.has(' ')||talkTap,talkAt:c?talkClock(c.t):-1};}
/** Confrontation time as the player sees it: online states arrive ~30 Hz, so extrapolate between them. */
let talkBase={t:0,at:0};
function talkClock(t:number){return mode==='online'?t+Math.min(.12,(performance.now()-talkBase.at)/1000):t;}
function drawTalk(){const c=confrontationFor(state,localId),panel=$('talk');panel.hidden=!c||state.phase!=='playing';if(!c||panel.hidden)return;if(c.t!==talkBase.t)talkBase={t:c.t,at:performance.now()};const t=talkClock(c.t);
 const zone=$('talk-zone');zone.style.left=`${(c.center-c.width)*100}%`;zone.style.width=`${c.width*200}%`;$('talk-needle').style.left=`${talkNeedle(t)*100}%`;$('talk-time').style.width=`${Math.max(0,1-t/c.duration)*100}%`;}
function frame(now:number){requestAnimationFrame(frame);const dt=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;
 if(getaway){driveGetaway(dt,now);return;}
 if(loaded&&state.phase==='playing'&&mode!=='menu'&&!(mode==='practice'&&$<HTMLDialogElement>('pause-menu').open)){
  // Solo runs the shared rules at 60 Hz for crisp movement; online sends input at the server's 30 Hz.
  const step=mode==='practice'?1/60:1/30;accumulator+=dt;
  while(accumulator>=step){const input=readInput(now);if(mode==='practice'){stepHeist(state,new Map([[localId,input]]),step);accept(state);}else if(now-lastSend>32){send({type:'input',...input});lastSend=now;}accumulator-=step;takedownTap=false;talkTap=false;}
  const me=player();if(me&&Math.hypot(me.vx??0,me.vz??0)>.6&&!me.crouching){const interval=Math.hypot(me.vx??0,me.vz??0)>4?280:420;if(now-lastStep>interval){audio.cue('step');lastStep=now;}}
 }
 drawTalk();view?.draw(state,localId,now,mode==='menu'||state.phase==='lobby'||state.phase==='won'||state.phase==='lost');if(now-lastUI>100){updateHUD();lastUI=now;}}
let lastPauseToggle=0;
function togglePause(){const now=performance.now();if(now-lastPauseToggle<250)return;lastPauseToggle=now;const d=$<HTMLDialogElement>('pause-menu');if(d.open){d.close();if(!getaway)view.lockPointer();return;}if(state.phase!=='playing'&&!getaway)return;clearInput();expectUnlock=true;view.unlockPointer();$('pause-copy').textContent=getaway?'The cops will wait. Take a breath behind the wheel.':mode==='practice'?'The guards and the clock are waiting for you.':'Your crew is still playing — the clock keeps running in an online room.';d.showModal();}
pauseButton.onclick=togglePause;$('resume-game').onclick=()=>{$<HTMLDialogElement>('pause-menu').close();if(!getaway)view.lockPointer();};$('pause-leave').onclick=menu;
$('sensitivity').oninput=()=>{const v=Number($<HTMLInputElement>('sensitivity').value);view.sensitivity=v/10000;try{localStorage.setItem('laser-sensitivity',String(v));}catch{}};
function toggleMap(){const choice=$<HTMLSelectElement>('job-choice');choice.innerHTML='<option value="">Choose freely</option>'+currentJobs(state).map(o=>`<option value="${o.id}">${esc(o.label)}</option>`).join('');choice.value=state.claims[localId]??'';choice.onchange=()=>mode==='practice'?claimHeistJob(state,localId,choice.value):send({type:'job',job:choice.value});const d=$<HTMLDialogElement>('tactical');if(d.open){d.close();view.lockPointer();}else{keys.clear();holding=false;view.resetMovement();expectUnlock=true;view.unlockPointer();d.showModal();drawMap($<HTMLCanvasElement>('big-map'));}}
// Losing pointer lock mid-run (Esc in the browser) pauses the game, like any desktop shooter.
document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement)return;if(expectUnlock){expectUnlock=false;return;}if(state.phase==='playing'&&mode!=='menu'&&!modalOpen())togglePause();});
window.addEventListener('keydown',e=>{if(e.target instanceof HTMLElement&&e.target.matches('input,select,textarea'))return;const k=e.key.toLowerCase();if(k==='p'&&!e.repeat&&state.phase==='playing'){mode==='practice'?pingHeist(state,localId):send({type:'ping'});return;}if(k==='escape'&&!e.repeat&&(state.phase==='playing'||!!getaway)&&!$<HTMLDialogElement>('guide').open&&!$<HTMLDialogElement>('tactical').open){e.preventDefault();togglePause();return;}if(k==='m'&&!e.repeat&&state.phase==='playing'){e.preventDefault();toggleMap();return;}if(k==='c'&&!e.repeat&&state.phase==='playing'){crouch=!crouch;navigator.clear(localId);return;}if(k==='f'&&!e.repeat)takedownTap=true;if(k===' '&&!e.repeat)talkTap=true;if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','e','f','shift',' '].includes(k)){e.preventDefault();keys.add(k);}if(k==='escape'){route=null;keys.clear();holding=false;}});window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',clearInput);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearInput();});
$('museum').addEventListener('click',()=>{if(state.phase==='playing'&&mode!=='menu'&&!modalOpen())view.lockPointer();});$('lock-hint').onclick=()=>view.lockPointer();
$('settings').onclick=()=>{clearInput();$<HTMLInputElement>('settings-sensitivity').value=$<HTMLInputElement>('sensitivity').value;$('reset-progress').textContent='Erase progress';$<HTMLDialogElement>('settings-menu').showModal();};
$('settings-sensitivity').oninput=()=>{$<HTMLInputElement>('sensitivity').value=$<HTMLInputElement>('settings-sensitivity').value;$('sensitivity').dispatchEvent(new Event('input'));};
// Erasing progress takes two clicks so it can't happen by accident.
$('reset-progress').onclick=()=>{const b=$('reset-progress');if(b.dataset.armed!=='1'){b.dataset.armed='1';b.textContent='Click again to erase';return;}b.dataset.armed='';campaign=emptyCampaign();saveCampaign(campaign);career=emptyCareer();try{localStorage.removeItem('laser-career-v1');}catch{}selectedLevel=0;$<HTMLDialogElement>('settings-menu').close();menu();notify('Progress erased. A fresh crew, an empty account.');};
$('help').onclick=()=>{clearInput();expectUnlock=true;view.unlockPointer();$<HTMLDialogElement>('guide').showModal();};document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(b=>b.onclick=()=>{$<HTMLDialogElement>(b.dataset.close!).close();if(state.phase==='playing'&&mode!=='menu')view.lockPointer();});$('sound').onclick=$('pause-sound').onclick=$('settings-sound').onclick=toggleSound;$('open-map').onclick=$('mini-map').onclick=toggleMap;$('cancel-route').onclick=()=>{route=null;navigator.clear(localId);$<HTMLDialogElement>('tactical').close();view.lockPointer();};
$('big-map').onclick=e=>{const rect=$('big-map').getBoundingClientRect();route={x:((e.clientX-rect.left)/rect.width)*32-16,z:((e.clientY-rect.top)/rect.height)*24-12};navigator.clear(localId);$<HTMLDialogElement>('tactical').close();view.lockPointer();notify('Route marked. Any movement key cancels it.');};
$('touch-crouch').onclick=()=>{crouch=!crouch;navigator.clear(localId);};$('touch-takedown').onclick=()=>takedownTap=true;$('touch-talk').onpointerdown=e=>{e.preventDefault();talkTap=true;};const action=$('touch-action');action.onpointerdown=e=>{e.preventDefault();action.setPointerCapture(e.pointerId);holding=true;};action.onpointerup=action.onpointercancel=()=>holding=false;document.querySelectorAll<HTMLButtonElement>('[data-key]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(b.dataset.key!)};b.onpointerup=b.onpointercancel=()=>keys.delete(b.dataset.key!);});
document.addEventListener('heist-render-error',e=>notify((e as CustomEvent).detail));
try{view=new MuseumView($<HTMLCanvasElement>('museum'),$('labels'),$('markers'));view.sensitivity=Number($<HTMLInputElement>('sensitivity').value)/10000;menu();requestAnimationFrame(frame);void view.load(m=>$('load-message').textContent=m).then(()=>{loaded=true;$('loading').hidden=true;menu();loadGetawayCity();checkOnline();try{if(!localStorage.getItem('laser-guide-seen')){localStorage.setItem('laser-guide-seen','1');$<HTMLDialogElement>('guide').showModal();}}catch{}}).catch(error=>{console.error(error);$('load-message').textContent='A crew asset could not load. Reload to try again.';const b=document.createElement('button');b.className='cta';b.textContent='Reload';b.onclick=()=>location.reload();$('loading').append(b);});}catch(error){console.error(error);$('load-message').textContent='This game needs WebGL. Enable hardware acceleration or try another browser.';}
// Dev-only handle for playtesting from the console; stripped from production builds.
if(import.meta.env.DEV)Object.assign(window,{__heist:{get state(){return state;},get view(){return view;},get getaway(){return getaway;},get campaign(){return campaign;},practice:(level:number)=>practice(level),openBoard,startCampaign,finish:(phase:'won'|'lost')=>{state.phase=phase;state.securedValue=phase==='won'?Math.floor(state.lootValue):0;accept(state);}}});
