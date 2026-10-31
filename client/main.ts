import './style.css';
import { ArenaRenderer } from './render';
import { GameInput } from './input';
import { GameAudio } from './audio';
import type { RoomState } from '../shared/protocol';
const app=document.querySelector<HTMLDivElement>('#app')!;
const input=new GameInput(), audio=new GameAudio();
let renderer:ArenaRenderer;
let state:RoomState|null=null, myId:string|null=null, socket:WebSocket|null=null, screen='', busy=false, disconnected=false;
let lastSnapshot=0, clockOffset=0, lastWarning='', toastTimer:ReturnType<typeof setTimeout>;
const eventIds=new Set<string|number>();
const storedName=()=>localStorage.getItem('orbit-name')||'';
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const logo=`<span class="orbit-mark" aria-hidden="true">◉</span><span>ORBIT<span class="logo-light"> KNOCKOUT</span></span>`;
app.innerHTML=`<header><a class="brand" href="/" aria-label="Orbit Knockout home">${logo}</a><div class="header-actions"><span id="connection" class="connection">PRIVATE ARENA · 2–6 PLAYERS</span><button id="help" class="icon-button" aria-label="How to play">?</button><button id="sound" class="icon-button" aria-label="Toggle sound">♪</button></div></header><main id="surface"></main><div id="toast" role="status" aria-live="polite"></div><dialog id="rules"><button class="close icon-button" aria-label="Close rules">×</button><p class="eyebrow">FLIGHT MANUAL / 01</p><h2>Stay in orbit.</h2><p>Knock everyone else off the platform. No health bars. Just momentum.</p><ol class="rules-list"><li><b>Move & dash</b><span>WASD or arrows to move. Space to dash in your moving direction.</span></li><li><b>Charge & release</b><span>Hold E or the Pulse button. Release to push nearby rivals. More charge means more reach and force.</span></li><li><b>Watch the edge</b><span>Outer rings fall every 15 seconds. A 3-second warning tells you to move inward.</span></li><li><b>Last one standing</b><span>Win 3 rounds to take the match. A simultaneous fall is a draw. Fall out and spectate until the next round.</span></li></ol><p class="fine">On touchscreens, use the left stick and the two action buttons. Late arrivals enter at the next round. If fewer than two players remain, the match returns to the lobby.</p><button class="primary close-rules">Got it. Let's orbit. <span>↗</span></button></dialog>`;
const surface=document.querySelector<HTMLElement>('#surface')!;
const rules=document.querySelector<HTMLDialogElement>('#rules')!;
document.querySelector('#help')!.addEventListener('click',()=>{input.reset();rules.showModal();audio.unlock();});
for(const e of rules.querySelectorAll('.close,.close-rules'))e.addEventListener('click',()=>rules.close());
rules.addEventListener('click',e=>{if(e.target===rules)rules.close();});
document.querySelector('#sound')!.addEventListener('click',()=>{audio.toggle();updateSound();});
function updateSound(){const b=document.querySelector<HTMLButtonElement>('#sound')!;b.textContent=audio.muted?'♫̸':'♪';b.setAttribute('aria-label',audio.muted?'Unmute sound':'Mute sound');b.setAttribute('aria-pressed',String(!audio.muted));}updateSound();
function toast(message:string){const t=document.getElementById('toast')!;t.textContent=message;t.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),5500);}
function send(value:unknown){if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
function formBusy(value:boolean){busy=value;surface.querySelectorAll<HTMLButtonElement>('form button').forEach(e=>e.disabled=value);const b=document.querySelector('#create');if(b)b.textContent=value?'Connecting…':'Create private room ↗';}
function connect(action:'create'|'join',name:string,code?:string){
 if(busy)return;audio.unlock();localStorage.setItem('orbit-name',name);formBusy(true);disconnected=false;
 socket?.close();const ws=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/ws`);socket=ws;
 const timeout=setTimeout(()=>{if(ws.readyState!==WebSocket.OPEN){ws.close();toast('The server is taking a moment. Please try again.');formBusy(false);}},18000);
 ws.addEventListener('open',()=>{clearTimeout(timeout);ws.send(JSON.stringify({type:action,name,code}));});
 ws.addEventListener('message',e=>{if(ws!==socket)return;try{const msg=JSON.parse(e.data);if(msg.type==='error'){toast(msg.message);formBusy(false);}else if(msg.type==='welcome'){myId=msg.id;state=null;history.replaceState(null,'',`?room=${encodeURIComponent(msg.code)}`);eventIds.clear();formBusy(false);}else if(msg.type==='state'){state=msg.state;lastSnapshot=performance.now();clockOffset=state!.serverTime-Date.now();if(state!.players.some(p=>p.id===myId)){renderUI();renderer?.update(state,myId);for(const ev of state!.events){if(!eventIds.has(ev.id)){eventIds.add(ev.id);audio.tone(ev.type);}}if(eventIds.size>300)eventIds.clear();}}}catch{toast('An unexpected server message was received.');}});
 ws.addEventListener('close',()=>{clearTimeout(timeout);if(ws!==socket)return;formBusy(false);disconnected=true;input.setEnabled(false);screen='';renderUI();toast('Connection lost. Rejoin the room to continue. Your previous round entry has been removed.');});
 ws.addEventListener('error',()=>{if(ws===socket)toast('Could not reach the game server. Check your connection and try again.');});
}
function leave(){send({type:'leave'});const ws=socket;socket=null;ws?.close();state=null;myId=null;disconnected=false;screen='';history.replaceState(null,'',location.pathname);input.reset();renderer?.update(null,null);renderUI();}
function renderUI(){
 const phase=disconnected?'disconnected':state?.phase||'home';const key=phase==='countdown'||phase==='playing'||phase==='roundEnd'?'game':phase;
 if(key===screen){updateUI();return;}screen=key;document.body.dataset.screen=key;
 if(key==='home'||key==='disconnected'){
  const code=new URLSearchParams(location.search).get('room')||state?.code||'';
  surface.innerHTML=`<section class="landing"><div class="hero-copy"><p class="eyebrow"><span class="live-dot"></span> MULTIPLAYER / ZERO GRAVITY / ZERO MERCY</p><h1>Stay in<br><em>orbit.</em></h1><p class="intro">One arena. A hungry black hole.<br>Your friends are the only thing in your way.</p><div class="hero-tags"><span>2–6 PLAYERS</span><span>FIRST TO 3 WINS</span><span>NO SIGNUP</span></div></div><section class="join-panel"><div class="panel-top"><span class="eyebrow">${disconnected?'SIGNAL LOST':'READY FOR LAUNCH?'}</span><span class="panel-coordinate">◎ 001</span></div><h2>${disconnected?'Back in the fight.':'Bring your crew.'}</h2><p>${disconnected?'Rejoin to return at the next round.':'Create an arena. Send the link. Settle it in orbit.'}</p><form id="entry"><label for="name">CALLSIGN</label><input id="name" name="name" maxlength="18" placeholder="Your display name" required autocomplete="nickname" value="${esc(storedName())}"><button class="primary" id="create" type="submit">Create private room <span>↗</span></button><div class="divider"><span>OR JOIN YOUR FRIENDS</span></div><div class="join-row"><input id="room-code" aria-label="Room code" maxlength="6" placeholder="ROOM CODE" value="${esc(code.toUpperCase())}" autocapitalize="characters" autocomplete="off"><button id="join" type="button" class="secondary">Join <span>→</span></button></div></form><p class="fine">Real people. Real-time knockout.<br>You'll need at least one friend to start.</p></section><div class="landing-bottom"><span>01 / OUTLAST THE PULL</span><button class="text-button" id="learn">How to play <span>↗</span></button></div></section>`;
  const name=()=>document.querySelector<HTMLInputElement>('#name')!;
  document.querySelector('#entry')!.addEventListener('submit',e=>{e.preventDefault();if(name().reportValidity())connect('create',name().value.trim());});
  document.querySelector('#join')!.addEventListener('click',()=>{const code=document.querySelector<HTMLInputElement>('#room-code')!.value.trim().toUpperCase();if(!name().reportValidity())return;if(!/^[A-Z0-9]{4,6}$/.test(code)){toast('Enter the room code from your friend’s invitation.');return;}connect('join',name().value.trim(),code);});
  document.querySelector('#learn')!.addEventListener('click',()=>rules.showModal());
 }else if(key==='lobby'){
  surface.innerHTML=`<section class="lobby-panel panel"><p class="eyebrow">PRE-FLIGHT / PRIVATE ROOM</p><div class="title-row"><h2>Your crew.</h2><button id="leave" class="text-button">Leave ↗</button></div><div class="invite"><div><span class="eyebrow">ROOM CODE</span><strong id="code"></strong></div><button id="invite" class="secondary">Copy invite ↗</button></div><input id="invite-link" aria-label="Invitation link" readonly hidden><div class="list-title"><span>CALLSIGN</span><span id="crew-count"></span></div><div id="players" class="player-list"></div><div class="lobby-actions"><button id="ready" class="secondary">Ready up</button><button id="start" class="primary">Launch match ↗</button></div><p id="lobby-status" class="fine" role="status"></p><div class="briefing"><b>THE MISSION</b><p>Push your rivals off. Stay inside the shrinking rings. First to win <strong>3 rounds</strong> takes the match.</p><div class="mini-controls"><span><kbd>WASD</kbd> Move</span><span><kbd>SPACE</kbd> Dash</span><span><kbd>E</kbd> Hold & release pulse</span></div><p class="touch-hint">Touch: left stick to move · Dash to escape · Hold and release Pulse to push.</p></div></section>`;
  document.getElementById('leave')!.onclick=leave;
  document.getElementById('invite')!.onclick=async()=>{const url=new URL(location.href);url.search=`?room=${state!.code}`;try{await navigator.clipboard.writeText(url.href);toast('Invite copied. Send it to your crew.');}catch{const box=document.querySelector<HTMLInputElement>('#invite-link')!;box.hidden=false;box.value=url.href;box.select();toast('Copy this invitation link and send it to your friend.');}};
  document.getElementById('ready')!.onclick=()=>{audio.unlock();send({type:'ready',ready:!state?.players.find(p=>p.id===myId)?.ready});};
  document.getElementById('start')!.onclick=()=>{audio.unlock();send({type:'start'});(document.activeElement as HTMLElement)?.blur();};
 }else if(key==='game'){
  surface.innerHTML=`<section class="game-hud"><div class="match-meta"><span class="eyebrow" id="round-label"></span><strong id="collapse-timer"></strong></div><div id="scores" class="score-strip"></div><button id="leave" class="text-button leave-game">Leave room ↗</button><div id="announcement" aria-live="polite"><span id="announce-kicker"></span><strong id="announce-title"></strong><span id="announce-sub"></span></div><div id="spectator" class="spectator" hidden>OUT OF ORBIT · Spectating until next round</div><div id="joystick" aria-label="Movement joystick"><div id="stick"></div></div><div class="ability-controls"><button id="dash" class="ability"><span class="ability-symbol">↯</span><span>DASH <kbd>SPACE</kbd></span><small id="dash-status">Ready</small><i id="dash-meter"></i></button><button id="charge" class="ability pulse"><span class="ability-symbol">◎</span><span>PULSE <kbd>E</kbd></span><small id="wave-status">Hold & release</small><i id="wave-meter"></i></button></div><div class="desktop-hint"><kbd>W A S D</kbd> Move <span>·</span> Hold <kbd>E</kbd> to charge. Release to push.</div></section>`;
  input.bind();document.getElementById('leave')!.onclick=leave;
 }else if(key==='results'){
  surface.innerHTML=`<section class="results-panel panel"><p class="eyebrow">MATCH COMPLETE / FIRST TO THREE</p><div class="trophy">✧</div><h2 id="champion"></h2><p>Own the orbit.</p><div id="results-list" class="player-list"></div><button id="rematch" class="primary">Run it back ↗</button><button id="back-lobby" class="secondary">Return to lobby</button><p id="result-note" class="fine"></p><button id="leave" class="text-button">Leave room ↗</button></section>`;
  document.getElementById('rematch')!.onclick=()=>send({type:'rematch'});document.getElementById('back-lobby')!.onclick=()=>send({type:'lobby'});document.getElementById('leave')!.onclick=leave;audio.tone('win');
 }
 updateUI();
}
function text(id:string,value:string){const el=document.getElementById(id);if(el&&el.textContent!==value)el.textContent=value;}
function updateUI(){
 text('connection',disconnected?'CONNECTION LOST':state?`LIVE · ROOM ${state.code}`:'PRIVATE ARENA · 2–6 PLAYERS');
 if(!state||disconnected)return;
 const me=state.players.find(p=>p.id===myId), host=state.hostId===myId;
 if(screen==='lobby'){
  text('code',state.code);text('crew-count',`${state.players.length} / 6`);
  document.getElementById('players')!.innerHTML=state.players.map(p=>`<div class="player-row"><span class="player-avatar" style="--player:${esc(p.color)}">◉</span><span class="player-name">${esc(p.name)} ${p.id===myId?'<small>YOU</small>':''}${p.id===state!.hostId?'<small>HOST</small>':''}</span><span class="ready-state ${p.ready?'is-ready':''}">${p.ready?'✓ READY':'GETTING READY'}</span></div>`).join('');
  const ready=document.querySelector<HTMLButtonElement>('#ready')!;ready.textContent=me?.ready?'✓ Ready — undo':'Ready up';ready.classList.toggle('selected',!!me?.ready);
  const start=document.querySelector<HTMLButtonElement>('#start')!;start.hidden=!host;start.disabled=state.players.length<2||!state.players.every(p=>p.ready);
  text('lobby-status',state.message|| (state.players.length<2?'Share your invitation. At least 2 players are needed.':!state.players.every(p=>p.ready)?'Everyone must ready up before launch.':host?'Your crew is ready. Launch when you are.':'Waiting for the host to launch.'));
 }
 if(screen==='game'){
  text('round-label',`ROUND ${state.round} / FIRST TO 3`);
  const seconds=Math.max(0,Math.ceil((state.nextCollapseAt-(Date.now()+clockOffset))/1000));
  const warning=state.phase==='playing'&&seconds<=3;
  text('collapse-timer',state.phase==='playing'?`${warning?'⚠ RING COLLAPSE':'NEXT COLLAPSE'} · ${seconds}s`:'HOLD YOUR ORBIT');document.getElementById('collapse-timer')!.classList.toggle('warning',warning);
  if(warning&&lastWarning!==`${state.round}-${state.radius}-${seconds}`){lastWarning=`${state.round}-${state.radius}-${seconds}`;audio.tone('countdown');}
  document.getElementById('scores')!.innerHTML=state.players.map(p=>`<div class="score ${!p.alive?'out':''} ${p.id===myId?'self':''}" style="--player:${esc(p.color)}"><span class="score-dot"></span><span>${esc(p.name)}${p.id===myId?' · YOU':''}</span><b>${p.score}<small>/3</small></b></div>`).join('');
  const announcement=document.getElementById('announcement')!;announcement.hidden=state.phase==='playing';
  if(state.phase==='countdown'){text('announce-kicker','GET READY');text('announce-title',String(Math.max(1,Math.ceil((state.phaseEndsAt-Date.now()-clockOffset)/1000))));text('announce-sub','Stay on the platform. Push everyone else off.');}
  else if(state.phase==='roundEnd'){const winner=state.players.find(p=>p.id===state!.roundWinnerId);text('announce-kicker',winner?'ROUND WINNER':'SIMULTANEOUS FALL');text('announce-title',winner?`${winner.name} wins`:'Draw. No point.');text('announce-sub','Next round launching shortly');}
  document.getElementById('spectator')!.hidden=!!me?.alive||state.phase!=='playing';
  const available=state.phase==='playing'&&!!me?.alive&&performance.now()-lastSnapshot<2500&&!rules.open;
  input.setEnabled(available);
  for(const id of ['dash','charge'])document.querySelector<HTMLButtonElement>(`#${id}`)!.disabled=!available;
  text('dash-status',me&&me.dashCooldown>0?`${me.dashCooldown.toFixed(1)}s`:'Ready');text('wave-status',me&&me.waveCooldown>0?`${me.waveCooldown.toFixed(1)}s`:me&&me.charge>0?`${Math.round(me.charge*100)}% · release!`:'Hold & release');
  document.getElementById('dash-meter')!.style.setProperty('--fill',`${me?Math.max(0,1-me.dashCooldown/2)*100:0}%`);
  document.getElementById('wave-meter')!.style.setProperty('--fill',`${me?(me.charge>0?me.charge:Math.max(0,1-me.waveCooldown/1))*100:0}%`);
  document.getElementById('charge')!.classList.toggle('charging',!!me&&me.charge>0);
 }
 if(screen==='results'){
  text('champion',`${state.players.find(p=>p.id===state!.winnerId)?.name||'Your crew'} wins.`);
  document.getElementById('results-list')!.innerHTML=[...state.players].sort((a,b)=>b.score-a.score).map((p,i)=>`<div class="player-row"><span class="rank">0${i+1}</span><span class="player-avatar" style="--player:${esc(p.color)}">◉</span><span class="player-name">${esc(p.name)}</span><b>${p.score} <small>WINS</small></b></div>`).join('');
  for(const id of ['rematch','back-lobby'])document.querySelector<HTMLButtonElement>(`#${id}`)!.hidden=!host;
  text('result-note',host?'Rematch starts a fresh match with the connected crew.':'Waiting for the host to choose a rematch or return to lobby.');input.setEnabled(false);
 }
}
try{renderer=new ArenaRenderer(document.querySelector<HTMLCanvasElement>('#arena')!);}catch{document.body.classList.add('no-webgl');setTimeout(()=>toast('3D rendering is unavailable. Enable hardware acceleration or try another browser.'),500);}
renderUI();
setInterval(()=>{if(screen==='game'){if(performance.now()-lastSnapshot>2500){input.setEnabled(false);text('connection','RECONNECTING SIGNAL…');}if(rules.open)input.reset();send(input.frame());updateUI();}},33);
window.addEventListener('pagehide',()=>{socket?.close();renderer?.dispose();});
