/** Coordinates are metres. These definitions own both the visible and physical layout. */
export type Point = { x: number; z: number };
export type Rect = Point & { w: number; d: number };
export type CrewRole = 'hacker'|'infiltrator'|'carrier'|'lookout';
/** The lasting advantage a crew job gives everyone: cameras looped, lasers cut, escape gear staged, guard radio tapped. */
export type CrewPerk = 'cameras'|'lasers'|'haul'|'radio';
/** `assist` objectives are optional crew jobs only `role` can do; no map ever needs one to finish. */
export type Objective = Point & { id: string; label: string; kind: 'task'|'hold'|'security'|'loot'|'assist'; requires: string[]; seconds: number; specialty?: 'hacker'|'infiltrator'; role?: CrewRole; perk?: CrewPerk; hold?: string; release?: string; optional?: boolean; bonus?: number; sectors?: string[]; hint: string };
/** `swing` is where an opened leaf comes to rest; it is solid while the gate stands open. */
export type Gate = Rect & { id: string; label: string; requires?: string[]; hold?: string; crawl?: boolean; closesOnTheft?: boolean; cartCross?: 'x'|'z'; swing?: Rect };
export type Sector = Rect & { id: string; label: string; period: number; active: number; offset: number; /** Chest-height beams: crouching passes underneath. */ high?: boolean };
/** A patrolling guard walks its route as a loop. A camera sweeps around `yaw` by ±`sweep` radians. */
export type GuardSpec = { id: string; route: Point[] };
export type CameraSpec = Point & { id: string; yaw: number; sweep: number; speed?: number };
/** Solid furniture. Below 1.5 m it hides crouched players from guards; taller pieces block sight entirely. `style` picks the Blender model. */
export type Cover = Rect & { style: string; height?: number };
export interface Contract {
 rooms: (Rect & {label:string})[]; floors: Rect[]; gates: Gate[]; objectives: Objective[]; sectors: Sector[];
 cargo: 'case'|'cart'|'core'; escapeSeconds: number[]; allowances: number[]; briefing: string; escape: Point[];
 guards: GuardSpec[]; cameras: CameraSpec[]; cover: Cover[];
}
const task=(id:string,label:string,x:number,z:number,requires:string[]=[],extra:Partial<Objective>={}):Objective=>({id,label,x,z,requires,kind:'task',seconds:3,hint:'Hold interact to complete. Progress latches permanently.',...extra});
const hold=(id:string,label:string,x:number,z:number,requires:string[],release:string):Objective=>task(id,label,x,z,requires,{kind:'hold',seconds:6,release,hint:'Hold to power immediately; keep holding 6 seconds to install your reusable clamp. Then leave it and complete the paired job.'});
const security=(id:string,x:number,z:number,sectors:string[]):Objective=>task(id,'Divert local security',x,z,['entry'],{kind:'security',sectors,seconds:1,optional:true,hint:'Hold interact for a safe window. Lookouts create a longer window.'});
/** One per role per map, away from the others, so a full crew fans out: each does its own job, then regroups. */
const job=(id:string,role:CrewRole,perk:CrewPerk,label:string,x:number,z:number,hint:string,extra:Partial<Objective>={}):Objective=>task(id,label,x,z,['entry'],{kind:'assist',role,perk,optional:true,seconds:4,hint,...extra});
const HAUL_HINT='+30 seconds on the clock, and whoever carries the score moves at Carrier speed.';
const RADIO_HINT='Guards are 35% slower to notice the crew, bluffs get easier, and every patrol shows on the map.';
const room=(label:string,x:number,z:number,w:number,d:number)=>({label,x,z,w,d});
export const CONTRACTS: Contract[] = [
 {
 cargo:'case',allowances:[480,420,390,360],escapeSeconds:[150,130,115,100],
 briefing:'Open deliveries. Clamp the east service release, crouch through conservation, and disable the interlock. Stage the case and loading signal in parallel. Theft seals deliveries; leave north through the ring.',
 rooms:[room('DELIVERIES',0,8,30,7),room('CENTRAL GALLERY',0,-1,13,12),room('SECURITY',-11,-1,8,12),room('CONSERVATION',11,-1,8,12),room('LOADING COURT',0,-9.5,30,4)],
 floors:[{x:0,z:0,w:32,d:24}],
 gates:[{id:'staff',label:'Staff entrance',x:0,z:4,w:4,d:.35,requires:['entry'],closesOnTheft:true},{id:'vent',label:'Service crawl / clamp',x:11,z:4,w:2,d:.35,hold:'release',requires:['isolate'],crawl:true},{id:'return',label:'Conservation return',x:7,z:0,w:.35,d:3,requires:['isolate']},{id:'north',label:'Loading route',x:0,z:-8,w:4,d:.35,requires:['isolate']}],
 objectives:[task('entry','Open delivery entrance',-4,7,[],{specialty:'hacker'}),hold('release','Conservation release',8,6,['entry'],'isolate'),task('isolate','Disable exhibit interlock',11,0,['entry'],{hold:'release',specialty:'infiltrator',hint:'Crouch through the released service passage. Hold to open the full-size return door and north exit permanently.'}),task('case','Stage protective case',-10,-4,['entry']),task('signal','Prepare loading signal',-10,-7,['entry']),security('security',-11,0,['gallery-a','gallery-b']),task('side-exhibit','Optional miniature collection',-12,-5,['entry'],{optional:true,bonus:1800}),task('loot','Secure the artifact',0,-5,['isolate','case','signal'],{kind:'loot',seconds:2,hint:'Theft starts lockdown and seals deliveries. Your prepared north route stays open.'}),
  job('loop-cams','hacker','cameras','Loop the camera feeds',-14.8,6.5,'The courtyard camera stays dark for the rest of the job.'),job('cut-lasers','infiltrator','lasers','Cut the gallery laser relay',14.2,-6.6,'Both gallery laser lanes shut down for good.',{sectors:['gallery-a','gallery-b']}),job('stage-gear','carrier','haul','Stage the escape gear',14.8,6.4,HAUL_HINT),job('tap-radio','lookout','radio','Tap the guard radio',-15.2,-4,RADIO_HINT)],
 sectors:[{id:'gallery-a',label:'Gallery laser A',x:0,z:-1,w:12,d:.6,period:12,active:3,offset:0},{id:'gallery-b',label:'Gallery laser B',x:0,z:-3,w:12,d:.6,period:12,active:6,offset:3,high:true},{id:'court',label:'Courtyard scan',x:0,z:-9.3,w:7,d:.7,period:14,active:3,offset:0}],
 escape:[{x:0,z:-5},{x:4,z:-6.5},{x:0,z:-9},{x:-10,z:-10}],
 guards:[{id:'gallery',route:[{x:-5,z:2.6},{x:5,z:2.6},{x:5,z:-6.6},{x:-5,z:-6.6}]},{id:'security',route:[{x:-14.5,z:2.5},{x:-14.5,z:-6.5},{x:-8.5,z:-6.5},{x:-8.5,z:2.5}]}],
 cameras:[{id:'court-cam',x:15.4,z:-11.4,yaw:-1.35,sweep:.55}],
 cover:[{x:-3.5,z:1,w:2.2,d:.7,style:'vitrine'},{x:3.5,z:1,w:2.2,d:.7,style:'vitrine'},{x:-4,z:-5,w:1,d:1,style:'statue'},{x:4,z:-5,w:1,d:1,style:'statue'},{x:-11.5,z:-2.2,w:2,d:.7,style:'desk'},{x:14.5,z:-3,w:1.2,d:3,style:'workbench'},{x:-12,z:9,w:1.4,d:1.4,style:'crates'},{x:13,z:8.5,w:1.4,d:1.4,style:'crates'},{x:8,z:-10.5,w:1.4,d:1,style:'crates'},{x:12,z:-10.3,w:1.2,d:1.2,style:'crates'}],
 },
 {
 cargo:'cart',allowances:[600,540,510,480],escapeSeconds:[240,210,190,180],
 briefing:'Authorize security and records in either order. Clamp the pressure stabilizer and release the vault. Hold interact to drive the braked gold cart. Park in each bay, clamp the next freight gate, then drive through; crossed gates stay open.',
 rooms:[room('BANKING HALL',-2,8,24,7),room('SECURITY OFFICES',-10,-1,8,10),room('RECORDS',6,-1,6,10),room('VAULT',-1,-3,8,7),room('FREIGHT / BAY A',0,-9,28,4),room('FREIGHT / BAY B',12,-1,5,15),room('GETAWAY VAN',12,8,5,7)],
 floors:[{x:0,z:0,w:32,d:24}],
 gates:[{id:'staff',label:'Bank staff access',x:0,z:4,w:4,d:.35,requires:['entry']},{id:'vault',label:'Vault service door',x:0,z:0,w:3,d:.35,hold:'pressure',requires:['isolate'],crawl:true},{id:'rear',label:'Vault freight door',x:0,z:-7,w:4,d:.35,requires:['isolate'],swing:{x:-4.5,z:-8,w:3.9,d:1.6}},{id:'freight-a',label:'Freight gate A',x:5,z:-9.5,w:.35,d:5,hold:'gate-a',cartCross:'x'},{id:'freight-b',label:'Freight gate B',x:12,z:1,w:7.5,d:.35,hold:'gate-b',cartCross:'z'}],
 objectives:[task('entry','Override bank access',-4,7,[],{specialty:'hacker'}),task('auth-west','Security authorization',-11,-4,['entry'],{seconds:5,specialty:'hacker'}),task('auth-east','Records authorization',6,-4,['entry'],{seconds:5,specialty:'infiltrator'}),hold('pressure','Vault pressure stabilizer',3,2,['auth-west','auth-east'],'isolate'),task('isolate','Release vault and freight door',0,-4,['auth-west','auth-east'],{hold:'pressure',specialty:'infiltrator'}),task('van','Prepare getaway van',12,8,['entry']),task('loot','Load gold on braked cart',0,-5.8,['isolate','van'],{kind:'loot',seconds:3,hint:'Hold interact near the cart to drive. Release to brake. Use the sheltered bays and clamp each freight control.'}),hold('gate-a','Freight A clamp socket',2,-9,['isolate'],'freight-a'),hold('gate-b','Freight B clamp socket',12,-2,['isolate'],'freight-b'),task('extra-gold','Optional extra gold crate',-2,-4,['isolate'],{optional:true,bonus:3500,hint:'Load an extra crate. Adds value and makes the cart slightly slower.'}),security('security',-10,0,['office']),security('freight-security',12,-5,['freight-scan-a','freight-scan-b']),
  job('loop-cams','hacker','cameras','Loop the camera feeds',-14.8,5.2,'The hall and bay cameras stay dark for the rest of the job.'),job('cut-lasers','infiltrator','lasers','Cut the freight scanners',7.2,-6.3,'Both freight scan spans shut down, so the cart never waits.',{sectors:['freight-scan-a','freight-scan-b']}),job('stage-gear','carrier','haul','Stage the escape gear',14.8,5.2,HAUL_HINT+' The extra crate stops slowing the cart.'),job('tap-radio','lookout','radio','Tap the guard radio',-15.2,-1,RADIO_HINT)],
 sectors:[{id:'office',label:'Office scanner',x:-10,z:-2,w:7,d:.7,period:14,active:7,offset:0,high:true},{id:'freight-scan-a',label:'Freight span A',x:7,z:-9.5,w:1.4,d:4,period:16,active:3,offset:0},{id:'freight-scan-b',label:'Freight span B',x:12,z:3,w:6,d:1,period:16,active:3,offset:5}],
 escape:[{x:0,z:-5.8},{x:0,z:-9.5},{x:12,z:-9.5},{x:12,z:8}],
 guards:[{id:'offices',route:[{x:-14.5,z:2.5},{x:-14.5,z:-5.5},{x:-5.5,z:-5.5},{x:-5.5,z:2.5}]},{id:'antechamber',route:[{x:-3,z:3.2},{x:-3,z:0.6},{x:-1,z:0.6}]},{id:'freight',route:[{x:-14,z:-10.4},{x:-6,z:-10.4}]}],
 cameras:[{id:'hall-cam',x:-15.4,z:11.4,yaw:2.4,sweep:.5},{id:'bay-cam',x:15.4,z:-11.4,yaw:-.4,sweep:.45},{id:'records-cam',x:8.6,z:-6.6,yaw:-2.5,sweep:.6}],
 cover:[{x:-10,z:6.5,w:5,d:.7,style:'counter'},{x:6,z:6.5,w:4,d:.7,style:'counter'},{x:-11.5,z:1.5,w:2.4,d:.7,style:'desk'},{x:-10,z:-10.8,w:1.4,d:1.2,style:'crates'},{x:-5,z:-10.8,w:1.4,d:1.2,style:'crates'},{x:15,z:-6,w:1.2,d:1.2,style:'crates'},{x:14.6,z:9.2,w:2,d:4.2,style:'van',height:2.2}],
 },
 {
 cargo:'core',allowances:[720,660,600,540],escapeSeconds:[210,180,160,150],
 briefing:'Prepare the helipad relay and perimeter screens before taking the core. Clamp cooling, crouch through the service shutter, and isolate the core. Theft closes the direct bridge. Follow the lit perimeter between shelters to the helicopter.',
 rooms:[room('ARRIVAL ROOF',-10,7,10,8),room('VAULT ROOF',8,-6,12,10),room('HELIPAD',-10,-7,10,8),room('MAINTENANCE BRIDGE',0,6,18,3),room('DIRECT BRIDGE',8,1,3,12),room('PERIMETER CATWALK',-1,-7,14,3),room('SERVICE RETURN',-10,0,3,12)],
 floors:[{x:-10,z:7,w:10,d:8},{x:8,z:-6,w:12,d:10},{x:-10,z:-7,w:10,d:8},{x:0,z:6,w:18,d:3},{x:8,z:1,w:3,d:12},{x:-1,z:-7,w:14,d:3},{x:-10,z:0,w:3,d:12}],
 gates:[{id:'bridge',label:'Direct bridge shutter',x:8,z:2,w:3,d:.35,requires:['entry'],closesOnTheft:true},{id:'service',label:'Core service crawl',x:8,z:-3,w:3,d:.35,hold:'cooling',requires:['isolate'],crawl:true}],
 objectives:[task('entry','Open maintenance shutter',-7,6,[],{specialty:'hacker'}),task('relay','Arm helicopter relay',-11,-8,['entry']),task('screens','Deploy perimeter screens',-3,-7,['entry']),hold('cooling','Cooling bypass',8,-1,['entry'],'isolate'),task('isolate','Isolate power core',9,-7,['entry'],{hold:'cooling',specialty:'infiltrator'}),task('roof-cache','Optional rooftop cache',12,-5,['entry'],{optional:true,bonus:4000}),security('security',5,-5,['span-east']),security('perimeter-security',0,-7,['span-west']),task('loot','Remove isolated core',11,-8,['isolate','relay','screens'],{kind:'loot',seconds:2,hint:'Commit to lockdown: the direct bridge closes. Take the core west across the lit perimeter to the prepared helicopter.'}),
  job('loop-cams','hacker','cameras','Loop the camera feeds',-8.5,10.2,'The bridge camera stays dark for the rest of the job.'),job('cut-lasers','infiltrator','lasers','Cut the searchlight power',13,-1.8,'Both perimeter searchlights go dark for good.',{sectors:['span-east','span-west']}),job('stage-gear','carrier','haul','Stage the escape gear',-13,-5.5,HAUL_HINT),job('tap-radio','lookout','radio','Tap the guard radio',-2,7.1,RADIO_HINT)],
 sectors:[{id:'span-east',label:'East searchlight',x:1,z:-7,w:2,d:3,period:16,active:3,offset:0},{id:'span-west',label:'West searchlight',x:-5,z:-7,w:2,d:3,period:16,active:3,offset:6}],
 escape:[{x:11,z:-8},{x:5,z:-7},{x:0,z:-7},{x:-10,z:-7}],
 guards:[{id:'vault-roof',route:[{x:3,z:-10.3},{x:13.3,z:-10.3},{x:13.3,z:-4},{x:3,z:-4}]},{id:'helipad',route:[{x:-14.3,z:-4},{x:-14.3,z:-10.3}]}],
 cameras:[{id:'bridge-cam',x:9.3,z:6.8,yaw:-2.3,sweep:.9}],
 cover:[{x:6.5,z:-7.5,w:1.6,d:1.2,style:'hvac'},{x:-13,z:5,w:1.4,d:1.4,style:'hvac'},{x:12.6,z:-9.8,w:1.2,d:1.2,style:'hvac'}],
 }
];
