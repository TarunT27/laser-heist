export type InputFrame = {type:'input';x:number;z:number;dash:boolean;charge:boolean};
export class GameInput {
  private keys=new Set<string>(); private joystick={x:0,z:0}; private chargePointers=new Set<number>(); private dashPointers=new Set<number>();
  private enabled=false; private joyId:number|null=null;
  constructor() {
    window.addEventListener('keydown',e=>{if(!this.enabled || (e.target instanceof HTMLElement && /INPUT|TEXTAREA|BUTTON/.test(e.target.tagName)))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyE'].includes(e.code)){e.preventDefault();this.keys.add(e.code);}});
    window.addEventListener('keyup',e=>this.keys.delete(e.code));
    window.addEventListener('blur',()=>this.reset());document.addEventListener('visibilitychange',()=>{if(document.hidden)this.reset();});
  }
  setEnabled(value:boolean){this.enabled=value;if(!value)this.reset();}
  reset(){this.keys.clear();this.joystick={x:0,z:0};this.chargePointers.clear();this.dashPointers.clear();this.joyId=null;document.querySelector<HTMLElement>('#stick')?.style.setProperty('transform','translate(0px,0px)');}
  frame():InputFrame{
    if(!this.enabled)return {type:'input',x:0,z:0,dash:false,charge:false};
    let x=this.joystick.x+Number(this.keys.has('KeyD')||this.keys.has('ArrowRight'))-Number(this.keys.has('KeyA')||this.keys.has('ArrowLeft'));
    let z=this.joystick.z+Number(this.keys.has('KeyS')||this.keys.has('ArrowDown'))-Number(this.keys.has('KeyW')||this.keys.has('ArrowUp'));
    const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}
    return {type:'input',x,z,dash:this.keys.has('Space')||this.dashPointers.size>0,charge:this.keys.has('KeyE')||this.chargePointers.size>0};
  }
  bind(){
    const joy=document.querySelector<HTMLElement>('#joystick');
    const move=(e:PointerEvent)=>{if(e.pointerId!==this.joyId||!joy)return;const r=joy.getBoundingClientRect(),max=r.width*.32;let x=(e.clientX-r.left-r.width/2)/max,z=(e.clientY-r.top-r.height/2)/max;const length=Math.hypot(x,z);if(length>1){x/=length;z/=length;}this.joystick={x,z};document.querySelector<HTMLElement>('#stick')!.style.transform=`translate(${x*max}px,${z*max}px)`;};
    joy?.addEventListener('pointerdown',e=>{if(this.joyId!==null)return;this.joyId=e.pointerId;joy.setPointerCapture(e.pointerId);move(e);e.preventDefault();});
    joy?.addEventListener('pointermove',move);
    const release=(e:PointerEvent)=>{if(e.pointerId===this.joyId){this.joyId=null;this.joystick={x:0,z:0};document.querySelector<HTMLElement>('#stick')!.style.transform='translate(0,0)';}};
    joy?.addEventListener('pointerup',release);joy?.addEventListener('pointercancel',release);joy?.addEventListener('lostpointercapture',release);
    for(const [id,set] of [['dash',this.dashPointers],['charge',this.chargePointers]] as const){const el=document.getElementById(id);el?.addEventListener('pointerdown',e=>{e.preventDefault();el.setPointerCapture(e.pointerId);set.add(e.pointerId);});for(const event of ['pointerup','pointercancel','lostpointercapture'])el?.addEventListener(event,e=>set.delete((e as PointerEvent).pointerId));}
  }
}
