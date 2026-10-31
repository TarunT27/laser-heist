export type Cue='click'|'alarm'|'loot'|'win'|'door'|'suspicious'|'spotted'|'takedown'|'caught'|'lose'|'step';
/** Original synthesized interface, security and ambient score; no network audio. */
export class HeistAudio{
 enabled=false;private context:AudioContext|null=null;private master:GainNode|null=null;private ambience:OscillatorNode[]=[];private tension:GainNode|null=null;
 toggle(){this.enabled=!this.enabled;if(!this.context){this.context=new AudioContext();this.master=this.context.createGain();this.master.connect(this.context.destination);this.master.gain.value=0;for(const freq of [110,164.81,220]){const o=this.context.createOscillator(),g=this.context.createGain();o.type='sine';o.frequency.value=freq;g.gain.value=.012;o.connect(g).connect(this.master);o.start();this.ambience.push(o);}
  // A low pulse that swells while guards are suspicious of you.
  const pulse=this.context.createOscillator(),lfo=this.context.createOscillator(),depth=this.context.createGain();this.tension=this.context.createGain();this.tension.gain.value=0;pulse.type='sawtooth';pulse.frequency.value=55;lfo.frequency.value=2.2;depth.gain.value=.5;lfo.connect(depth).connect(this.tension.gain);const filter=this.context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=260;pulse.connect(filter).connect(this.tension).connect(this.master);pulse.start();lfo.start();}
  void this.context.resume();this.master!.gain.setTargetAtTime(this.enabled?1:0,this.context.currentTime,.25);if(this.enabled)this.cue('click');return this.enabled;}
 /** 0 calm … 1 spotted. */
 setTension(level:number){if(!this.context||!this.tension)return;this.tension.gain.setTargetAtTime(this.enabled?Math.min(1,level)*.05:0,this.context.currentTime,.3);}
 private drive:{nodes:AudioScheduledSourceNode[];engine:OscillatorNode;engineGain:GainNode;sirenGain:GainNode}|null=null;
 /** Getaway sound bed: an engine that follows speed and a wailing siren that follows the nearest cruiser. */
 startDrive(){if(!this.context||!this.master||this.drive)return;const c=this.context;
  const engine=c.createOscillator(),sub=c.createOscillator(),filter=c.createBiquadFilter(),engineGain=c.createGain();engine.type='sawtooth';sub.type='square';filter.type='lowpass';filter.frequency.value=420;engineGain.gain.value=0;
  engine.connect(filter);sub.connect(filter);filter.connect(engineGain).connect(this.master);sub.frequency.value=22;
  const siren=c.createOscillator(),wail=c.createOscillator(),depth=c.createGain(),sirenGain=c.createGain();siren.type='triangle';siren.frequency.value=860;wail.frequency.value=0.42;depth.gain.value=260;sirenGain.gain.value=0;
  wail.connect(depth).connect(siren.frequency);siren.connect(sirenGain).connect(this.master);
  for(const n of [engine,sub,siren,wail])n.start();
  this.drive={nodes:[engine,sub,siren,wail],engine,engineGain,sirenGain};}
 /** speed in m/s; siren 0 (none) … 1 (right behind you). */
 setDrive(speed:number,siren:number){if(!this.drive||!this.context)return;const t=this.context.currentTime,on=this.enabled?1:0;
  this.drive.engine.frequency.setTargetAtTime(34+Math.abs(speed)*2.3,t,.08);this.drive.engineGain.gain.setTargetAtTime(on*(.03+Math.min(30,Math.abs(speed))*.0016),t,.1);this.drive.sirenGain.gain.setTargetAtTime(on*siren*.045,t,.2);}
 stopDrive(){if(!this.drive)return;for(const n of this.drive.nodes){try{n.stop();}catch{}n.disconnect();}this.drive.engineGain.disconnect();this.drive.sirenGain.disconnect();this.drive=null;}
 /** A thump scaled by impact speed (m/s). */
 crash(strength:number){if(!this.enabled||!this.context||!this.master)return;const c=this.context,len=.35,buffer=c.createBuffer(1,c.sampleRate*len,c.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,3);const src=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();src.buffer=buffer;f.type='lowpass';f.frequency.value=500+strength*40;g.gain.value=Math.min(.6,.08+strength*.025);src.connect(f).connect(g).connect(this.master);src.start();}
 cue(kind:Cue){if(!this.enabled||!this.context||!this.master)return;const c=this.context;
  if(kind==='step'||kind==='takedown'){const len=kind==='step'?.05:.25,buffer=c.createBuffer(1,c.sampleRate*len,c.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,kind==='step'?6:2);const src=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();src.buffer=buffer;f.type='lowpass';f.frequency.value=kind==='step'?700:300;g.gain.value=kind==='step'?.05:.4;src.connect(f).connect(g).connect(this.master);src.start();return;}
  const table:Record<string,number[]>={win:[440,554.37,659.25,880],loot:[659.25,880],alarm:[180,140,180,140],door:[330,440],suspicious:[740],spotted:[300,600,900],caught:[220,165,110],lose:[330,262,196,131],click:[520]};
  const freqs=table[kind]??[520];const wave:OscillatorType=kind==='alarm'||kind==='spotted'?'square':kind==='caught'||kind==='lose'?'triangle':'sine';
  freqs.forEach((freq,i)=>{const o=c.createOscillator(),g=c.createGain();o.frequency.value=freq;o.type=wave;const t=c.currentTime+i*(kind==='spotted'?.06:.13);const peak=kind==='alarm'||kind==='spotted'?.06:kind==='suspicious'?.03:.07;g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(peak,t+.02);g.gain.exponentialRampToValueAtTime(.001,t+.4);o.connect(g).connect(this.master!);o.start(t);o.stop(t+.45);});
 }
}
