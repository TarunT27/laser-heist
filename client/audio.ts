export class GameAudio {
  private context: AudioContext | null = null;
  muted = localStorage.getItem('orbit-muted') === 'true';
  unlock() { try { this.context ??= new AudioContext(); void this.context.resume(); } catch { /* Audio is optional. */ } }
  toggle() { this.muted = !this.muted; localStorage.setItem('orbit-muted', String(this.muted)); this.unlock(); return this.muted; }
  tone(kind: 'wave'|'dash'|'collapse'|'elimination'|'countdown'|'win') {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const ctx=this.context, osc=ctx.createOscillator(), gain=ctx.createGain();
    const freq={wave:180,dash:420,collapse:75,elimination:140,countdown:650,win:880}[kind];
    osc.type=kind==='collapse'?'sawtooth':'sine'; osc.frequency.setValueAtTime(freq,ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(kind==='win'?1320:freq*0.3,ctx.currentTime+0.3);
    gain.gain.setValueAtTime(0.075,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.38);
    osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+0.4);
  }
}
