/** Real WebSocket clients. Accelerated authoritative tick, ordinary input protocol. */
import {createServer} from 'node:http';import {WebSocket} from 'ws';import assert from 'node:assert/strict';
import {attachHeistServer} from '../server/heist';import {RouteDriver} from '../server/tests/heist-route';import type{HeistState}from'../shared/heist';
const http=createServer(),server=attachHeistServer(http);await new Promise<void>(r=>http.listen(0,'127.0.0.1',r));const port=(http.address() as {port:number}).port;
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function client(){const ws=new WebSocket(`ws://127.0.0.1:${port}/heist/ws`);let id='',code='',state:HeistState|undefined;const errors:string[]=[];ws.on('message',data=>{const m=JSON.parse(data.toString());if(m.type==='welcome'){id=m.id;code=m.code;}if(m.type==='state')state=m.state;if(m.type==='error')errors.push(m.message);});await new Promise(r=>ws.on('open',r));return{ws,send:(m:unknown)=>ws.send(JSON.stringify(m)),get id(){return id},get code(){return code},get state(){return state},errors};}
try{for(let level=0;level<3;level++){
 const a=await client(),b=await client();a.send({type:'create',name:'Network A'});while(!a.id)await sleep(10);b.send({type:'join',name:'Network B',code:a.code});while(!b.id)await sleep(10);
 a.send({type:'level',level});a.send({type:'role',role:'hacker'});b.send({type:'role',role:'hacker'});await sleep(60);a.send({type:'ready',ready:true});b.send({type:'ready',ready:true});await sleep(60);a.send({type:'start'});await sleep(60);
 const room=server.rooms.get(a.code)!;assert.equal(room.state.phase,'playing');const driver=new RouteDriver(room.state);
 for(let tick=0;tick<6000&&room.state.phase==='playing';tick++){
  const inputs=driver.inputs();a.send({type:'input',...inputs[a.id]});b.send({type:'input',...inputs[b.id]});await sleep(18);
  server.tick(Date.now(),1/30);server.tick(Date.now(),1/30);server.tick(Date.now(),1/30);
 }
 server.broadcast();await sleep(60);assert.equal(room.state.phase,'won',JSON.stringify({level,notice:room.state.notice,done:room.state.completed,players:room.state.players}));
 assert.equal(a.state?.phase,'won');assert.equal(b.state?.phase,'won');assert.deepEqual(a.state?.completed,b.state?.completed);assert.deepEqual(a.state?.cargo,b.state?.cargo);assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
 console.log(JSON.stringify({level,phase:room.state.phase,seconds:room.state.elapsed,alarms:room.state.alarms,clients:2,roles:'hacker+hacker',consistent:true}));a.ws.close();b.ws.close();
}}
finally{await server.close();await new Promise<void>(r=>http.close(()=>r()));}
