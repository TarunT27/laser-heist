type MovementVector = { x: number; z: number };

/**
 * Camera heading and input basis for the local third-person view.
 *
 * With a mouse (pointer lock) the player owns the camera: movement is always relative to
 * the live view and the camera never turns on its own. Touch has no free look, so `auto`
 * keeps the old behaviour of trailing the character's heading with a stable held basis.
 */
export class CameraFollow {
 yaw=0;
 auto=true;
 private movementYaw=0;
 private movementHeld=false;
 private manualLookUntil=0;

 movement(x:number,y:number):MovementVector{
  const moving=x!==0||y!==0;
  if(!this.auto||(moving&&!this.movementHeld)||!moving)this.movementYaw=this.yaw;
  this.movementHeld=moving;
  return{x:Math.cos(this.movementYaw)*x-Math.sin(this.movementYaw)*y,z:-Math.sin(this.movementYaw)*x-Math.cos(this.movementYaw)*y};
 }

 orbit(deltaX:number,now:number,sensitivity=.006){
  this.yaw-=deltaX*sensitivity;
  this.movementYaw=this.yaw;
  this.manualLookUntil=now+900;
 }

 follow(heading:number,speed:number,dt:number,now:number){
  if(!this.auto||speed<=.12||now<this.manualLookUntil)return;
  const targetYaw=heading-Math.PI;
  const difference=((targetYaw-this.yaw+Math.PI)%(Math.PI*2)+Math.PI*2)%(Math.PI*2)-Math.PI;
  this.yaw+=difference*(1-Math.exp(-4.5*dt));
 }

 resetMovement(){this.movementHeld=false;this.movementYaw=this.yaw;}

 reset(){this.yaw=0;this.movementYaw=0;this.movementHeld=false;this.manualLookUntil=0;}
}
