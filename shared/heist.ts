import { CONTRACTS, type Contract, type CrewPerk, type CrewRole, type Gate, type Objective, type Sector } from './heist-maps';
import type { FinaleMods, SetupSpec } from './heist-campaign';
export { CONTRACTS };
/**
 * Shared, deterministic rules for the three-map Laser Heist campaign.
 *
 * Nothing in this module depends on a browser or a socket. The server drives
 * it authoritatively, while a practice client can use the exact same state
 * machine (including seeded crew/AI players).
 */

export type HeistPhase = "lobby" | "playing" | "won" | "lost";
export type MissionStage = "infiltrate" | "override" | "loot" | "escape";
export type Role = CrewRole;
export const ROLE_NAMES: Record<Role, string> = { hacker: "Hacker", infiltrator: "Infiltrator", carrier: "Carrier", lookout: "Lookout" };

export interface HeistPlayer {
  id: string;
  name: string;
  x: number;
  z: number;
  yaw: number;
  color: number;
  role: Role;
  crouching: boolean;
  interacting?: boolean;
  carrying: boolean;
  connected: boolean;
  ready: boolean;
  /** Integer percentage of the team loot (0..100). */
  cut: number;
  /** Cumulative money earned by this player across completed maps. */
  earned: number;
  /** Momentum, metres per second. Movement accelerates toward the input instead of snapping. */
  vx: number;
  vz: number;
  /** 0..1 sprint reserve. Emptying it forces a short recovery before sprinting again. */
  stamina: number;
  exhausted: boolean;
  /** 0..1 footstep loudness this tick; guards hear within noise × 7 metres. */
  noise: number;
}

export type GuardMode = "patrol" | "suspicious" | "alert" | "search" | "stunned" | "confront";
export type Difficulty = "relaxed" | "standard" | "pro";
/** Multipliers on GUARD_CONSTANTS and the run rules for each difficulty preset. */
export const DIFFICULTY: Record<Difficulty, { label: string; blurb: string; sight: number; suspicion: number; hearing: number; talk: number; alarms: number; stun: number; time: number }> = {
  relaxed: { label: "Relaxed", blurb: "Slower guards, five alarms, more time.", sight: 0.85, suspicion: 0.6, hearing: 0.7, talk: 1.4, alarms: 5, stun: 40, time: 1.25 },
  standard: { label: "Standard", blurb: "The intended heist. Three alarms.", sight: 1, suspicion: 1, hearing: 1, talk: 1, alarms: 3, stun: 25, time: 1 },
  pro: { label: "Professional", blurb: "Sharp-eyed guards, two alarms, less time.", sight: 1.12, suspicion: 1.35, hearing: 1.3, talk: 0.7, alarms: 2, stun: 15, time: 0.85 },
};
/** The difficulty preset with the run's finale modifiers (approach, setups, crew) folded in. */
const tuning = (state: HeistState) => {
  const base = DIFFICULTY[state.difficulty] ?? DIFFICULTY.standard, mods = state.mods, radio = crewPerk(state, "radio");
  if (!mods?.suspicion && !mods?.talk && !radio) return base;
  return { ...base, suspicion: base.suspicion * (mods?.suspicion ?? 1) * (radio ? CREW_PERKS.RADIO_SUSPICION : 1), talk: base.talk * (mods?.talk ?? 1) * (radio ? CREW_PERKS.RADIO_TALK : 1) };
};

/** What each crew job's perk does, for the rules and the HUD. */
export const CREW_PERKS = { RADIO_SUSPICION: 0.65, RADIO_TALK: 1.35, HAUL_SECONDS: 30 } as const;
/** True once the crew job that grants this perk is done; it lasts for the rest of the run. */
export function crewPerk(state: HeistState, perk: CrewPerk): boolean {
  return MAPS[state.level]?.objectives.some((o) => o.perk === perk && state.completed?.includes(o.id)) ?? false;
}
/** This map's optional crew jobs, one per role. */
export function crewJobs(level: number): Objective[] {
  return (MAPS[level] ?? MAPS[0]).objectives.filter((o) => o.kind === "assist");
}

export interface MissionTarget { id: string; label: string; x: number; z: number; seconds: number; progress: number; done: boolean }
/** A finale is the full heist; a setup is a short prep job on the same map, won by finishing its targets and walking out. */
export type MissionState =
  | { kind: "finale" }
  | { kind: "setup"; id: string; name: string; targets: MissionTarget[]; exit: { x: number; z: number } };
export interface HeistGuard {
  id: string;
  kind: "guard" | "camera";
  x: number;
  z: number;
  /** Facing; forward is (sin yaw, cos yaw). */
  yaw: number;
  mode: GuardMode;
  /** 0..1; reaching 1 raises an alarm. */
  suspicion: number;
  target: string | null;
  lastSeen: { x: number; z: number } | null;
  timer: number;
  waypoint: number;
  moving: boolean;
  repathTimer?: number;
  /** Talked down at least once: suspicious faster, and `bluffed` counts how many times. */
  wary?: boolean;
  bluffed?: number;
  /** Seconds left ignoring everyone after being talked down. */
  calm?: number;
}

/** A guard has cornered a player; one press decides it. The needle is talkNeedle(t). */
export interface Confrontation {
  guard: string;
  player: string;
  t: number;
  /** Green zone centre and half-width on the 0..1 needle track. */
  center: number;
  width: number;
  duration: number;
}

export interface Payout {
  id: string;
  name: string;
  cut: number;
  amount: number;
}

export interface HeistInput {
  x: number;
  z: number;
  interact: boolean;
  /** Optional for old practice clients; missing values default to false/zero. */
  crouch?: boolean;
  sprint?: boolean;
  yaw?: number;
  /** Knock out an unaware guard from behind (edge-triggered). */
  takedown?: boolean;
  /** Bluff a confronting guard (edge-triggered), and the confrontation time the client saw when pressing. */
  talk?: boolean;
  talkAt?: number;
}

export type HeistInputMap = Map<string, HeistInput> | Record<string, HeistInput | undefined>;

export type HeistClientMessage =
  | { type: "create"; name: string }
  | { type: "join"; name: string; code: string }
  | { type: "start" }
  | { type: "ping" }
  | { type: "job"; job:string }
  | { type: "restart" }
  | { type: "next" }
  | { type: "level"; level: number }
  | { type: "difficulty"; difficulty: Difficulty }
  | { type: "role"; role: Role }
  | { type: "ready"; ready: boolean }
  | { type: "cuts"; cuts: Record<string, number> }
  | { type: "input"; x: number; z: number; interact: boolean; crouch?: boolean; sprint?: boolean; yaw?: number; takedown?: boolean; talk?: boolean; talkAt?: number };

export type HeistWelcomeMessage = {
  type: "welcome";
  id: string;
  code: string;
};

export type HeistServerMessage =
  | HeistWelcomeMessage
  | { type: "state"; state: HeistState }
  | { type: "error"; message: string };

export type HeistWireMessage = HeistServerMessage;

export interface WallRect {
  x: number;
  z: number;
  w: number;
  d: number;
  height: number;
  kind?: "door" | "vent" | "service" | "solid" | "cover";
}

export interface PropCollider {
  x: number;
  z: number;
  radius: number;
  kind: "pedestal" | "console";
}

export interface HeistMap extends Contract {
  id: number;
  name: string;
  subtitle: string;
  difficulty: number;
  time: number;
  loot: number;
  theme: string;
  laserCount: number;
  laserSpeed: number;
  terminal: { x: number; z: number };
  switch: { x: number; z: number };
  override: { x: number; z: number };
  scanner: { x: number; z: number };
  diamond: { x: number; z: number };
  exit: { x: number; z: number };
  spawns: readonly { x: number; z: number }[];
  walls: readonly WallRect[];
  props: readonly PropCollider[];
}

export interface HeistState {
  gateGrace: Record<string,string[]>;
  completed: string[];
  progress: Record<string, number>;
  holds: Record<string, string[]>;
  clamps: Record<string, { owner: string; progress: number; installed: boolean }>;
  cargo: { x:number; z:number; loaded:boolean; controller:string|null };
  recovery: number;
  recoveredDisconnect: boolean;
  practice: boolean;
  jobs: Record<string,string>;
  claims: Record<string,string>;
  /** Crew job id → id of the player who did it. */
  credits: Record<string,string>;
  pings: {id:string;x:number;z:number;until:number}[];

  code: string;
  hostId: string;
  phase: HeistPhase;
  players: HeistPlayer[];
  remaining: number;
  elapsed: number;
  alarms: number;
  doorOpen: boolean;
  doorTimer: number;
  plates: boolean[];
  diamondTaken: boolean;
  carrierId: string | null;
  escaped: string[];
  notice: string;
  level: number;
  missionStage: MissionStage;
  /** Normalized 0..1 progress for the terminal override. */
  hackProgress: number;
  hacked: boolean;
  /** True while a connected player holds E at the cooperative switch. */
  switchHeld: boolean;
  /** Normalized 0..1 progress for the inner console override. */
  overrideProgress: number;
  vaultOpen: boolean;
  /** Current gross value, reduced by alarms but never below 50% of base. */
  lootValue: number;
  securedValue: number;
  payouts: Payout[];
  campaignEarned: number;
  /** Seconds until the camera scanner re-arms. */
  scannerDisabled: number;
  sectorDisabled:Record<string,number>;
  /** Normalized 0..1 extraction progress. */
  extractProgress: number;
  guards: HeistGuard[];
  /** The facility locks down (run lost) when alarms reach this count. */
  maxAlarms: number;
  difficulty: Difficulty;
  takedowns: number;
  /** Times the crew bluffed a guard successfully. */
  talkouts: number;
  confrontations: Confrontation[];
  /** Name of the player whose cover was blown, when a run ends that way. */
  busted: string | null;
  mission: MissionState;
  mods: FinaleMods;
}

export interface LaserInfo {
  /** Legacy renderer aliases; the authoritative beam uses z/xMin/xMax. */
  x: number;
  zMin: number;
  zMax: number;
  z: number;
  xMin: number;
  xMax: number;
  gapSize: number;
  speed: number;
  phase: number;
}

const SPAWNS = [
  { x: -3, z: 9 },
  { x: -1, z: 9 },
  { x: 1, z: 9 },
  { x: 3, z: 9 },
] as const;

const wall=(x:number,z:number,w:number,d:number,height=2.5):WallRect=>({x,z,w,d,height,kind:'solid'});
const museumWalls=[wall(-9,4,14,.35),wall(6,4,8,.35),wall(14,4,4,.35),wall(-7,-1,.35,10),wall(7,-4,.35,5),wall(7,2.75,.35,2.5),wall(-9,-8,14,.35),wall(9,-8,14,.35)];
// The two piers are the round vault portal's lower corners beside the freight door (low, so the HD build leaves them to the portal art).
const bankWalls=[wall(-1.9,-7.13,.8,.98,2.3),wall(1.9,-7.13,.8,.98,2.3),wall(-9,4,14,.35),wall(6,4,8,.35),wall(9,-2,.35,12),wall(-9,-7,14,.35),wall(5.5,-7,7,.35),wall(-4,-3.5,.35,7),wall(4,-3.5,.35,7),wall(-2.75,0,2.5,.35),wall(2.75,0,2.5,.35),wall(-7,-1,.35,3)];
// Collision railings are the edges of the union of floor rectangles, all at y=0.
const skyWalls=[wall(4.25,-3,4.5,.35),wall(11.75,-3,4.5,.35)];
const MAP_LASER_Z = [-1,-3,-5,-7] as const;
export const MAPS: readonly HeistMap[] = CONTRACTS.map((contract,id)=>{
 const find=(key:string)=>contract.objectives.find(o=>o.id===key)!;
 return {...contract,id,name:['Museum After Hours','The Gilded Exchange','The Sky Vault'][id],subtitle:contract.briefing,difficulty:id+1,time:contract.allowances[0],loot:[12000,24000,48000][id],theme:['museum','art-deco-bank','cyber-sky-vault'][id],laserCount:id===0?2:0,laserSpeed:.9,
 terminal:find('entry'),switch:find(['release','pressure','cooling'][id]),override:find('isolate'),scanner:find('security'),diamond:find('loot'),exit:[{x:-10,z:-10},{x:12,z:8},{x:-10,z:-7}][id],
 spawns:id===2?[{x:-12,z:8},{x:-10,z:8},{x:-8,z:8},{x:-6,z:8}]:SPAWNS,
 walls:[...[museumWalls,bankWalls,skyWalls][id],...contract.cover.map(c=>({x:c.x,z:c.z,w:c.w,d:c.d,height:c.height??1.1,kind:((c.height??1.1)<1.5?'cover':'solid') as WallRect['kind']}))],props:contract.objectives.filter(o=>o.kind!=='loot').map(o=>({x:o.x,z:o.z,radius:.3,kind:'console' as const}))};
});

export const PLATES = [
  { x: -7, z: -3 },
  { x: -7, z: 3 },
] as const;
export const EXIT = MAPS[0].exit;
export const DIAMOND = MAPS[0].diamond;
export const LASERS: readonly LaserInfo[] = MAP_LASER_Z.map((z, index) => ({
  x: 0,
  zMin: -8,
  zMax: 8,
  z,
  xMin: -7,
  xMax: 7,
  gapSize: 2.5,
  speed: MAPS[Math.min(index, MAPS.length - 1)].laserSpeed,
  phase: index * 1.7,
}));

export const HEIST_CONSTANTS = {
  WORLD_MIN_X: -16,
  WORLD_MAX_X: 16,
  WORLD_MIN_Z: -12,
  WORLD_MAX_Z: 12,
  PLAYER_RADIUS: 0.38,
  PLAYER_SPEED: 3.2,
  CROUCH_SPEED: 1.6,
  SPRINT_SPEED: 5.2,
  CARRIER_SPEED: 3.2,
  NON_CARRIER_LOOT_SPEED: 2.6,
  DOOR_LATCH_SECONDS: 8,
  LASER_PENALTY_SECONDS: 12,
  TERMINAL_RADIUS: 1.5,
  TERMINAL_SECONDS: 3,
  OVERRIDE_RADIUS: 1.5,
  OVERRIDE_SECONDS: 3,
  SWITCH_RADIUS: 1.5,
  DIAMOND_RADIUS: 1.6,
  EXIT_RADIUS: 1.7,
  EXTRACT_RADIUS: 5,
  EXTRACT_SECONDS: 1.5,
  SCANNER_RADIUS: 1.5,
  SCANNER_SECONDS: 15,
  LOOKOUT_SCANNER_SECONDS: 25,
  SPOTLIGHT_X: 4,
  SPOTLIGHT_Z: -5,
  SPOTLIGHT_RADIUS: 1.4,
  HAZARD_PENALTY_SECONDS: 12,
  HAZARD_IMMUNITY_SECONDS: 2,
  ALARM_LOOT_MULTIPLIER: 0.95,
  MIN_LOOT_MULTIPLIER: 0.5,
  DOOR_HALF_WIDTH: 2,
  VENT_MIN_X: 10,
  VENT_MAX_X: 12,
  VENT_CROSS_Z: 3,
  MAX_PLAYERS: 4,
  MIN_PLAYERS: 1,
  ACCELERATION: 13,
  DECELERATION: 17,
  STAMINA_DRAIN: 0.22,
  CARRIER_STAMINA_DRAIN: 0.14,
  STAMINA_REGEN: 0.16,
  STAMINA_RECOVER: 0.35,
  EXHAUSTED_SPEED: 2.4,
} as const;

/** Security tuning. Ranges in metres, speeds in metres per second, angles in radians. */
export const GUARD_CONSTANTS = {
  PATROL_SPEED: 1.35,
  INVESTIGATE_SPEED: 1.2,
  SEARCH_SPEED: 2.0,
  FOV: Math.PI * 0.6,
  CAMERA_FOV: Math.PI * 0.4,
  RANGE: 7.5,
  CROUCH_RANGE: 4.2,
  CAMERA_RANGE: 8.5,
  STUN_SECONDS: 25,
  TAKEDOWN_RADIUS: 1.5,
  /** A takedown needs the player outside this half-angle of the guard's facing. */
  TAKEDOWN_BEHIND: 1.75,
  HEARING_PER_NOISE: 7,
  /** Bluffing: seconds to answer, needle angular speed (one sweep ≈ 0.9 s), green-zone half-width. */
  TALK_SECONDS: 4.5,
  TALK_NEEDLE_SPEED: 3.4,
  TALK_WINDOW: 0.11,
  CALM_SECONDS: 8,
  /** Times one guard can be talked down; each later bluff's window is this fraction of the last. */
  BLUFFS_PER_GUARD: 2,
  WARY_WINDOW: 0.55,
  WAYPOINT_PAUSE: 1.6,
  /** Suspicion per second at full clarity; a glimpse at mid range takes ~2 s to become an alarm. */
  SUSPICION: 1.05,
  SEARCH_SUSPICION: 1.8,
  CAMERA_SUSPICION: 0.9,
  /** Radians per second of the sinusoidal camera sweep (a ~20 s cycle). */
  CAMERA_SWEEP_SPEED: 0.32,
} as const;

/** Public role modifiers used by HUDs and practice-bot planning. */
export const ROLE_BONUSES = {
  HACKER_HACK_MULTIPLIER: 2,
  INFILTRATOR_OVERRIDE_MULTIPLIER: 2,
  CARRIER_LOOT_SPEED: 3.2,
  NON_CARRIER_LOOT_SPEED: 2.6,
  LOOKOUT_SCANNER_SECONDS: 25,
} as const;

interface InternalState {
  previousTakedown: Map<string, boolean>;
  previousTalk: Map<string, boolean>;
  laserImmunity: Map<string, number>;
  spotlightImmunity: Map<string, number>;
  previousInteract: Map<string, boolean>;
  baseLoot: number;
}

const internals = new WeakMap<HeistState, InternalState>();

function internalFor(state: HeistState): InternalState {
  let value = internals.get(state);
  if (!value) {
    value = {
      previousTakedown: new Map(),
      previousTalk: new Map(),
      laserImmunity: new Map(),
      spotlightImmunity: new Map(),
      previousInteract: new Map(),
      baseLoot: MAPS[state.level]?.loot ?? MAPS[0].loot,
    };
    internals.set(state, value);
  }
  return value;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distanceSquared(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt(distanceSquared(a, b));
}

function activePlayers(state: HeistState): HeistPlayer[] {
  return state.players.filter((player) => player.connected);
}

function inputFor(inputs: HeistInputMap | undefined, id: string): Required<HeistInput> {
  const value = inputs instanceof Map ? inputs.get(id) : inputs?.[id];
  return {
    x: finite(value?.x),
    z: finite(value?.z),
    interact: value?.interact === true,
    crouch: value?.crouch === true,
    sprint: value?.sprint === true,
    yaw: finite(value?.yaw),
    takedown: value?.takedown === true,
    talk: value?.talk === true,
    talkAt: finite(value?.talkAt, -1),
  };
}

function spawnFor(index: number, map: HeistMap): { x: number; z: number } {
  return map.spawns[index % map.spawns.length] ?? SPAWNS[0];
}

function roleFor(index: number, seed?: Role): Role {
  if (seed) return seed;
  return (["hacker", "infiltrator", "carrier", "lookout"] as const)[index % 4];
}

function makePlayer(
  source: Partial<HeistPlayer> & Pick<HeistPlayer, "id" | "name">,
  index: number,
  map: HeistMap,
): HeistPlayer {
  const spawn = spawnFor(index, map);
  return {
    id: source.id,
    name: source.name,
    x: finite(source.x, spawn.x),
    z: finite(source.z, spawn.z),
    yaw: finite(source.yaw),
    color: Number.isFinite(source.color) ? Number(source.color) : index % 4,
    role: roleFor(index, source.role),
    crouching: source.crouching === true,
    carrying: source.carrying === true,
    connected: source.connected !== false,
    ready: source.ready === true,
    cut: clamp(Math.round(finite(source.cut, 0)), 0, 100),
    earned: Math.max(0, Math.floor(finite(source.earned, 0))),
    vx: 0,
    vz: 0,
    stamina: 1,
    exhausted: false,
    noise: 0,
  };
}

function allocateEqualCuts(players: readonly HeistPlayer[]): void {
  const active = players.filter((player) => player.connected);
  for (const player of players) if (!player.connected) player.cut = 0;
  if (active.length === 0) return;
  const base = Math.floor(100 / active.length);
  let remainder = 100 - base * active.length;
  for (const player of active) {
    player.cut = base + (remainder > 0 ? 1 : 0);
    remainder -= 1;
  }
}

function cutsValid(state: HeistState): boolean {
  const active = activePlayers(state);
  return active.length > 0 && active.every((player) => Number.isInteger(player.cut) && player.cut >= 0 && player.cut <= 100) &&
    active.reduce((sum, player) => sum + player.cut, 0) === 100;
}

function clearReady(state: HeistState): void {
  for (const player of state.players) player.ready = false;
}

function setMapValues(state: HeistState, preserveCampaign = true): void {
  const map = MAPS[state.level] ?? MAPS[0];
  state.remaining = Math.round(map.allowances[Math.max(0, activePlayers(state).length-1)] * tuning(state).time);
  state.gateGrace={}; state.completed=[]; state.progress={}; state.holds={}; state.clamps={}; state.jobs={}; state.claims={}; state.credits={}; state.pings=[];
  state.cargo={...map.diamond,loaded:false,controller:null}; state.recovery=0; state.recoveredDisconnect=false;
  state.elapsed = 0;
  state.alarms = 0;
  state.doorOpen = false;
  state.doorTimer = 0;
  state.plates = [false, false];
  state.diamondTaken = false;
  state.carrierId = null;
  state.escaped = [];
  state.missionStage = "infiltrate";
  state.hackProgress = 0;
  state.hacked = false;
  state.switchHeld = false;
  state.overrideProgress = 0;
  state.vaultOpen = false;
  state.lootValue = map.loot;
  state.securedValue = 0;
  state.payouts = activePlayers(state).map((player) => ({ id: player.id, name: player.name, cut: player.cut, amount: 0 }));
  state.scannerDisabled = 0; state.sectorDisabled={};
  state.extractProgress = 0;
  for (const [index, player] of state.players.entries()) {
    const spawn = spawnFor(index, map);
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = 0;
    player.crouching = false;
    player.interacting = false;
    player.carrying = false;
    player.vx = 0; player.vz = 0; player.stamina = 1; player.exhausted = false; player.noise = 0;
  }
  state.guards = spawnGuards(map);
  state.maxAlarms = tuning(state).alarms;
  state.takedowns = 0;
  state.talkouts = 0;
  state.confrontations = [];
  state.busted = null;
  state.mission = { kind: "finale" };
  state.mods = {};
  const internal = internalFor(state);
  internal.previousTakedown.clear();
  internal.previousTalk.clear();
  internal.laserImmunity.clear();
  internal.spotlightImmunity.clear();
  internal.previousInteract.clear();
  internal.baseLoot = map.loot;
  if (!preserveCampaign) {
    state.campaignEarned = 0;
    for (const player of state.players) player.earned = 0;
  }
}

/** Create a fresh lobby. Seeds may include four local practice/AI crew members. */
export function createHeistState(
  code: string,
  hostId: string,
  players?: readonly (Partial<HeistPlayer> & Pick<HeistPlayer, "id" | "name">)[],
): HeistState {
  const seeded = players?.length ? players : [{ id: hostId, name: "Crew" }];
  const state: HeistState = {
    gateGrace:{},completed:[],progress:{},holds:{},clamps:{},cargo:{...MAPS[0].diamond,loaded:false,controller:null},recovery:0,recoveredDisconnect:false,practice:false,jobs:{},claims:{},credits:{},pings:[],
    code: String(code),
    hostId: String(hostId),
    phase: "lobby",
    players: seeded.map((player, index) => makePlayer(player, index, MAPS[0])),
    remaining: MAPS[0].time,
    elapsed: 0,
    alarms: 0,
    doorOpen: false,
    doorTimer: 0,
    plates: [false, false],
    diamondTaken: false,
    carrierId: null,
    escaped: [],
    notice: "Choose roles, split the loot, and ready up",
    level: 0,
    missionStage: "infiltrate",
    hackProgress: 0,
    hacked: false,
    switchHeld: false,
    overrideProgress: 0,
    vaultOpen: false,
    lootValue: MAPS[0].loot,
    securedValue: 0,
    payouts: [],
    campaignEarned: 0,
    scannerDisabled: 0,sectorDisabled:{},
    extractProgress: 0,
    guards: [],
    maxAlarms: 3,
    difficulty: "standard",
    takedowns: 0,
    talkouts: 0,
    confrontations: [],
    busted: null,
    mission: { kind: "finale" },
    mods: {},
  };
  allocateEqualCuts(state.players);
  state.payouts = state.players.map((player) => ({ id: player.id, name: player.name, cut: player.cut, amount: 0 }));
  internals.set(state, {
    previousTakedown: new Map(),
    previousTalk: new Map(),
    laserImmunity: new Map(),
    spotlightImmunity: new Map(),
    previousInteract: new Map(),
    baseLoot: MAPS[0].loot,
  });
  return state;
}

export function addHeistPlayer(
  state: HeistState,
  player: Partial<HeistPlayer> & Pick<HeistPlayer, "id" | "name">,
): HeistPlayer | null {
  if (state.phase !== "lobby" || state.players.some((candidate) => candidate.id === player.id)) return null;
  if (activePlayers(state).length >= HEIST_CONSTANTS.MAX_PLAYERS) return null;
  const created = makePlayer(player, state.players.length, MAPS[state.level] ?? MAPS[0]);
  state.players.push(created);
  allocateEqualCuts(state.players);
  clearReady(state);
  state.payouts = activePlayers(state).map((candidate) => ({ id: candidate.id, name: candidate.name, cut: candidate.cut, amount: 0 }));
  state.notice = `${created.name} joined — crew must ready again`;
  return created;
}

export function setHeistPlayerConnected(state: HeistState, id: string, connected: boolean): boolean {
  const player = state.players.find((candidate) => candidate.id === id);
  if (!player) return false;
  player.connected = connected;
  if (!connected) {
    player.ready = false;
    player.crouching = false;
    player.interacting = false;
    if (state.carrierId===id || state.cargo.controller===id) {
      state.cargo.x=player.x; state.cargo.z=player.z; state.cargo.controller=null;
      player.carrying=false; state.carrierId=null;
      state.notice=`${player.name} disconnected — recover the cargo at their marker`;
    }
    for(const key of Object.keys(state.holds)) state.holds[key]=state.holds[key].filter(holder=>holder!==id);
    for(const [key,value] of Object.entries(state.clamps)) if(value.owner===id&&!value.installed) delete state.clamps[key];
    if(state.phase==='playing'&&!state.recoveredDisconnect){
      state.recoveredDisconnect=true;state.recovery=5;
      const map=MAPS[state.level],count=Math.max(0,activePlayers(state).length-1);
      state.remaining+=state.diamondTaken?45:map.allowances[count]-map.allowances[Math.min(3,count+1)];
    }
  }
  if (state.phase === "lobby") {
    allocateEqualCuts(state.players);
    state.payouts = activePlayers(state).map((candidate) => ({ id: candidate.id, name: candidate.name, cut: candidate.cut, amount: 0 }));
    clearReady(state);
  }
  return true;
}

export function setHeistRole(state: HeistState, id: string, role: Role): boolean {
  if (state.phase !== "lobby") return false;
  const player = state.players.find((candidate) => candidate.id === id && candidate.connected);
  if (!player) return false;
  if (player.role === role) return true;
  player.role = role;
  clearReady(state);
  state.notice = `${player.name} chose ${role}`;
  return true;
}

export function setHeistReady(state: HeistState, id: string, ready: boolean): boolean {
  if (state.phase !== "lobby") return false;
  const player = state.players.find((candidate) => candidate.id === id && candidate.connected);
  if (!player) return false;
  player.ready = ready;
  return true;
}

export function setHeistCuts(state: HeistState, cuts: Record<string, number>): boolean {
  if (state.phase !== "lobby") return false;
  const active = activePlayers(state);
  const next = new Map<string, number>();
  for (const player of active) {
    const value = cuts[player.id];
    if (!Number.isInteger(value) || value < 0 || value > 100) return false;
    next.set(player.id, value);
  }
  if (Object.keys(cuts).some((id) => !active.some((player) => player.id === id))) return false;
  let total = 0;
  for (const player of active) total += next.get(player.id) ?? 0;
  if (total !== 100) return false;
  for (const player of state.players) player.cut = player.connected ? (next.get(player.id) ?? 0) : 0;
  clearReady(state);
  state.notice = "Loot split updated — crew must ready again";
  return true;
}

/** Select a campaign map in the lobby; callers should enforce host ownership. */
export function setHeistLevel(state: HeistState, level: number): boolean {
  if (state.phase !== "lobby" || !Number.isInteger(level) || level < 0 || level >= MAPS.length) return false;
  if (state.level === level) return true;
  state.level = level;
  setMapValues(state);
  clearReady(state);
  state.notice = `${MAPS[level].name} selected — crew must ready again`;
  return true;
}

/** Choose the difficulty preset in the lobby; callers should enforce host ownership. */
export function setHeistDifficulty(state: HeistState, difficulty: Difficulty): boolean {
  if (state.phase !== "lobby" || !Object.hasOwn(DIFFICULTY, difficulty)) return false;
  if (state.difficulty === difficulty) return true;
  state.difficulty = difficulty;
  setMapValues(state);
  clearReady(state);
  state.notice = `${DIFFICULTY[difficulty].label} difficulty — crew must ready again`;
  return true;
}

/** Turn a freshly started run into a setup mission: the targets, an exit at the entry point, open doors, a shorter clock. */
export function startSetup(state: HeistState, setup: SetupSpec): HeistState {
  state.mission = { kind: "setup", id: setup.id, name: setup.name, targets: setup.targets.map((t) => ({ ...t, progress: 0, done: false })), exit: { ...MAPS[state.level].spawns[0] } };
  state.completed = [...setup.open];
  state.hacked = state.completed.includes("entry");
  state.remaining = Math.round(setup.time * tuning(state).time);
  state.notice = setup.brief;
  return state;
}

/** Apply the planning board's advantages to a freshly started finale. */
export function applyFinaleMods(state: HeistState, mods: FinaleMods): HeistState {
  state.mods = { ...mods };
  state.remaining += mods.time ?? 0;
  if (mods.blackout) state.scannerDisabled = mods.blackout;
  if (mods.sectorsOff) for (const sector of MAPS[state.level].sectors) state.sectorDisabled[sector.id] = mods.sectorsOff;
  for (const id of mods.preComplete ?? []) latch(state, id);
  state.hacked = state.completed.includes("entry");
  state.vaultOpen = state.completed.includes("isolate");
  return state;
}

function updateSetup(state: HeistState, inputs: HeistInputMap, dt: number): void {
  if (state.mission.kind !== "setup") return;
  const mission = state.mission, players = activePlayers(state);
  state.jobs = {};
  for (const p of players) {
    const input = inputFor(inputs, p.id);
    p.interacting = false;
    if (!input.interact || Math.hypot(input.x, input.z) > 0.15 || confrontationFor(state, p.id)) continue;
    const target = mission.targets.filter((t) => !t.done && distance(p, t) < 1.6 && interactionReachable(state, p, t)).sort((a, b) => distance(p, a) - distance(p, b))[0];
    if (!target) continue;
    p.interacting = true;
    state.jobs[p.id] = target.label;
    target.progress = Math.min(1, target.progress + dt / target.seconds);
    if (target.progress >= 1 - 1e-8) {
      target.done = true;
      state.notice = mission.targets.every((t) => t.done) ? `${target.label} — done. Get back to the entry point.` : `${target.label} — done.`;
    }
  }
  if (mission.targets.every((t) => t.done) && players.length > 0 && players.every((p) => distance(p, mission.exit) < 2.5)) {
    state.phase = "won";
    state.securedValue = 0;
    state.escaped = players.map((p) => p.id);
    state.notice = `${mission.name} complete`;
  }
}

/** Start a run after the server has checked player count, ready state, and cuts. */
export function startHeist(state: HeistState): HeistState {
  if (state.phase === "playing") return state;
  setMapValues(state);
  state.phase = "playing";
  state.notice = MAPS[state.level].briefing;
  return state;
}

/** Reset the current level to a lobby while preserving campaign earnings. */
export function resetHeist(state: HeistState): HeistState {
  state.phase = "lobby";
  setMapValues(state);
  clearReady(state);
  state.notice = "Run reset — choose roles and ready up";
  return state;
}

/** Advance after a win; the final map has no next level. */
export function nextHeist(state: HeistState): HeistState | null {
  if (state.phase !== "won" || state.level >= MAPS.length - 1) return null;
  state.level += 1;
  state.phase = "lobby";
  setMapValues(state);
  clearReady(state);
  state.notice = `Map ${state.level + 1}: ${MAPS[state.level].name} — ready when you are`;
  return state;
}

/** Horizontal laser beam with a moving safe gap. */
export function laserAt(elapsed: number, index: number, level = 0): { x: number; z: number; active: boolean } {
  const map = MAPS[clamp(Math.round(level), 0, MAPS.length - 1)];
  const beamIndex = ((Math.floor(index) % map.laserCount) + map.laserCount) % map.laserCount;
  const z = MAP_LASER_Z[beamIndex] ?? MAP_LASER_Z[0];
  const speed = map.laserSpeed;
  const phase = beamIndex * 1.7;
  const span = 7 - 1.25;
  const x = Math.sin(Math.max(0, finite(elapsed)) * speed + phase) * span;
  const active = (Math.max(0, finite(elapsed)) + phase) % 4.2 < 3.7;
  return { x, z, active };
}

export function laserGap(elapsed: number, index: number, level = 0): number {
  return laserAt(elapsed, index, level).x;
}

export function isLaserActive(elapsed: number, index: number, level = 0): boolean {
  return laserAt(elapsed, index, level).active;
}

export function spotlightAt(elapsed: number): { x: number; z: number; radius: number } {
  const time = Math.max(0, finite(elapsed));
  return {
    x: HEIST_CONSTANTS.SPOTLIGHT_X + Math.sin(time * 0.37) * 2.1,
    z: HEIST_CONSTANTS.SPOTLIGHT_Z + Math.cos(time * 0.53) * 1.8,
    radius: HEIST_CONSTANTS.SPOTLIGHT_RADIUS,
  };
}

function circleHitsWall(x: number, z: number, radius: number, wall: WallRect): boolean {
  const nearestX = clamp(x, wall.x - wall.w / 2, wall.x + wall.w / 2);
  const nearestZ = clamp(z, wall.z - wall.d / 2, wall.z + wall.d / 2);
  return distanceSquared({ x, z }, { x: nearestX, z: nearestZ }) < radius * radius - 1e-8;
}

function circlesOverlap(ax: number, az: number, ar: number, bx: number, bz: number, br: number): boolean {
  return (ax - bx) ** 2 + (az - bz) ** 2 < (ar + br) ** 2;
}

export function gateOpen(state:HeistState,gate:Gate,player?:HeistPlayer):boolean {
 if(gate.id==='vault'&&player?.carrying&&MAPS[state.level].cargo==='cart')return false;
 if(state.gateGrace[gate.id]?.includes('cargo'))return true;
 if(player&&state.gateGrace[gate.id]?.includes(player.id))return true;
 if(state.completed.includes(gate.id))return true;
 const latched=gate.requires?.every(id=>state.completed.includes(id))===true;
 if(gate.closesOnTheft&&state.diamondTaken)return false;
 if(latched)return true;
 const held=gate.hold && ((state.holds[gate.hold]?.length??0)>0||state.clamps[gate.hold]?.installed);
 return !!held&&(!gate.crawl||!!player?.crouching);
}
export function objectiveAvailable(state:HeistState,o:Objective):boolean {
 return o.requires.every(id=>state.completed.includes(id));
}
export function sectorTiming(state:HeistState,sector:Sector){
 const phase=(state.elapsed+sector.offset)%sector.period;
 // An infiltrator's crew job cuts these sectors for good.
 const cut=MAPS[state.level].objectives.some(o=>o.perk==='lasers'&&o.sectors?.includes(sector.id)&&state.completed.includes(o.id));
 return {active:!cut&&(state.sectorDisabled[sector.id]??0)<=0&&phase<sector.active,remaining:phase<sector.active?sector.active-phase:sector.period-phase,cut};
}
/** Solid rectangles that gates add right now: closed leaves, and opened leaves that swing out into the room. */
function gateWalls(state:HeistState,player?:HeistPlayer):WallRect[]{
 return MAPS[state.level].gates.flatMap((g):WallRect[]=>!gateOpen(state,g,player)?[{x:g.x,z:g.z,w:g.w,d:g.d,height:2.6,kind:'door'}]:g.swing?[{...g.swing,height:2.6,kind:'solid'}]:[]);
}
function dynamicWalls(state:HeistState,player:HeistPlayer):WallRect[]{
 return gateWalls(state,player);
}

function collides(state: HeistState, player: HeistPlayer, x: number, z: number): boolean {
  if (x < HEIST_CONSTANTS.WORLD_MIN_X + HEIST_CONSTANTS.PLAYER_RADIUS || x > HEIST_CONSTANTS.WORLD_MAX_X - HEIST_CONSTANTS.PLAYER_RADIUS) return true;
  if (z < HEIST_CONSTANTS.WORLD_MIN_Z + HEIST_CONSTANTS.PLAYER_RADIUS || z > HEIST_CONSTANTS.WORLD_MAX_Z - HEIST_CONSTANTS.PLAYER_RADIUS) return true;
  const map = MAPS[state.level] ?? MAPS[0];
  // Check the whole footprint against the floor union, so roof edges act as railings.
  const r=player.carrying&&map.cargo==='cart'?.65:HEIST_CONSTANTS.PLAYER_RADIUS;
  for(const [dx,dz] of [[-r,-r],[-r,r],[r,-r],[r,r]]) if(!map.floors.some(f=>Math.abs(x+dx-f.x)<=f.w/2&&Math.abs(z+dz-f.z)<=f.d/2))return true;
  for (const wall of map.walls) if (circleHitsWall(x, z, r, wall)) return true;
  for (const prop of map.props) if (circlesOverlap(x, z, HEIST_CONSTANTS.PLAYER_RADIUS, prop.x, prop.z, prop.radius)) return true;
  for (const wall of dynamicWalls(state, player)) if (circleHitsWall(x, z, r, wall)) return true;
  return false;
}

/** Query the same collision volume used by `stepHeist` for practice pathfinding. */
export function canOccupyHeist(state: HeistState, player: HeistPlayer, x: number, z: number): boolean {
  return !collides(state, player, x, z);
}

function movePlayer(state: HeistState, player: HeistPlayer, input: Required<HeistInput>, dt: number): void {
  player.crouching = input.crouch && !player.carrying;
  const map = MAPS[state.level];
  player.interacting = input.interact && Math.hypot(input.x,input.z)<0.15 && map.objectives.some(target=>distance(player,target)<1.7);
  player.yaw = input.yaw;
  let x = clamp(input.x, -1, 1);
  let z = clamp(input.z, -1, 1);
  const magnitude = Math.hypot(x, z);
  if (magnitude > 1) {
    x /= magnitude;
    z /= magnitude;
  }
  // Sprinting spends a stamina reserve; running dry forces a recovery before the next burst.
  const sprinting = input.sprint && magnitude > 0.1 && !player.crouching && !player.carrying && !player.exhausted;
  if (sprinting) {
    player.stamina = Math.max(0, player.stamina - dt * (player.role === "carrier" ? HEIST_CONSTANTS.CARRIER_STAMINA_DRAIN : HEIST_CONSTANTS.STAMINA_DRAIN));
    if (player.stamina <= 0) player.exhausted = true;
  } else {
    player.stamina = Math.min(1, player.stamina + dt * HEIST_CONSTANTS.STAMINA_REGEN);
    if (player.exhausted && player.stamina >= HEIST_CONSTANTS.STAMINA_RECOVER) player.exhausted = false;
  }
  let speed: number = player.crouching ? HEIST_CONSTANTS.CROUCH_SPEED : (sprinting ? HEIST_CONSTANTS.SPRINT_SPEED : HEIST_CONSTANTS.PLAYER_SPEED);
  if (player.exhausted && !player.crouching) speed = HEIST_CONSTANTS.EXHAUSTED_SPEED;
  const haul = crewPerk(state, "haul");
  if (player.carrying) speed = player.role === "carrier" || haul ? ROLE_BONUSES.CARRIER_LOOT_SPEED : ROLE_BONUSES.NON_CARRIER_LOOT_SPEED;
  if(player.carrying&&map.cargo==='cart'&&state.completed.includes('extra-gold')&&!haul)speed*=.9;
  // Momentum: accelerate toward the requested velocity, brake a little harder than we accelerate.
  const rate = magnitude > 0.05 ? HEIST_CONSTANTS.ACCELERATION : HEIST_CONSTANTS.DECELERATION;
  const blend = 1 - Math.exp(-rate * dt);
  player.vx += (x * speed - player.vx) * blend;
  player.vz += (z * speed - player.vz) * blend;
  if (Math.hypot(player.vx, player.vz) < 0.02) { player.vx = 0; player.vz = 0; }
  const substeps = Math.max(1, Math.ceil(dt / 0.03));
  const slice = dt / substeps;
  for (let index = 0; index < substeps; index += 1) {
    const nx = player.x + player.vx * slice;
    const nz = player.z + player.vz * slice;
    if (!collides(state, player, nx, nz)) {
      player.x = nx;
      player.z = nz;
      continue;
    }
    // Axis-separated resolution slides along walls; the blocked axis loses its momentum.
    if (!collides(state, player, nx, player.z)) player.x = nx; else player.vx = 0;
    if (!collides(state, player, player.x, nz)) player.z = nz; else player.vz = 0;
  }
  const moved = Math.hypot(player.vx, player.vz);
  let noise = moved > HEIST_CONSTANTS.PLAYER_SPEED + 0.6 ? 1 : moved > 2.2 ? 0.4 : moved > 0.4 && !player.crouching ? 0.25 : 0;
  if (player.carrying && map.cargo === "cart" && moved > 0.4) noise = Math.max(noise, 0.7);
  if (player.role === "infiltrator") noise *= 0.6;
  player.noise = noise;
}

function pressEdge(state: HeistState, id: string, pressed: boolean): boolean {
  const internal = internalFor(state);
  const previous = internal.previousInteract.get(id) === true;
  internal.previousInteract.set(id, pressed);
  return pressed && !previous;
}

function setStage(state: HeistState): void {
  if (!state.hacked) state.missionStage = "infiltrate";
  else if (!state.vaultOpen) state.missionStage = "override";
  else if (!state.diamondTaken) state.missionStage = "loot";
  else state.missionStage = "escape";
}

function awardPayouts(state: HeistState): void {
  const total = Math.max(0, Math.floor(state.securedValue));
  const entries = state.players.map((player) => ({ id: player.id, name: player.name, cut: player.cut, amount: Math.floor(total * player.cut / 100) }));
  let remainder = total - entries.reduce((sum, entry) => sum + entry.amount, 0);
  for (const entry of entries) {
    if (remainder <= 0) break;
    if (entry.cut > 0) {
      entry.amount += 1;
      remainder -= 1;
    }
  }
  state.payouts = entries;
  for (const entry of entries) state.players.find((player) => player.id === entry.id)!.earned += entry.amount;
}

function reduceLootValue(state: HeistState): void {
  const internal = internalFor(state);
  const minimum = internal.baseLoot * HEIST_CONSTANTS.MIN_LOOT_MULTIPLIER;
  state.lootValue = Math.max(minimum, Math.floor(state.lootValue * HEIST_CONSTANTS.ALARM_LOOT_MULTIPLIER));
}

function triggerAlarm(state: HeistState, player: HeistPlayer, label: string): void {
  state.alarms += 1;
  if(!state.practice)state.remaining = Math.max(0, state.remaining - HEIST_CONSTANTS.HAZARD_PENALTY_SECONDS);
  reduceLootValue(state);
  state.notice = `Alarm! ${player.name} ${label} — 12 seconds and 5% of the take lost`;

}

function applyHazards(state:HeistState,player:HeistPlayer):void {
 const internal=internalFor(state);
 if((internal.laserImmunity.get(player.id)??0)>0)return;
 for(const sector of MAPS[state.level].sectors){
  if(sector.high&&player.crouching)continue;
  if(sectorTiming(state,sector).active&&Math.abs(player.x-sector.x)<sector.w/2&&Math.abs(player.z-sector.z)<sector.d/2){
   raiseAlarm(state,player,`tripped the ${sector.label.toLowerCase()}`);
   const responder=nearestGuard(state,player);if(responder)investigate(responder,player,"search");
   return;
  }
 }
}

function decayInternal(state: HeistState, dt: number): void {
  const internal = internalFor(state);
  for (const [id, value] of internal.laserImmunity) {
    if (value - dt <= 0) internal.laserImmunity.delete(id);
    else internal.laserImmunity.set(id, value - dt);
  }
  for (const [id, value] of internal.spotlightImmunity) {
    if (value - dt <= 0) internal.spotlightImmunity.delete(id);
    else internal.spotlightImmunity.set(id, value - dt);
  }
}

function interactionReachable(state:HeistState,p:HeistPlayer,target:{x:number;z:number}):boolean {
 const walls=[...MAPS[state.level].walls,...dynamicWalls(state,p)];
 for(let i=1;i<=8;i++){const t=i/8;if(walls.some(w=>circleHitsWall(p.x+(target.x-p.x)*t,p.z+(target.z-p.z)*t,.03,w)))return false;}
 return true;
}
export function claimHeistJob(state:HeistState,id:string,job:string){
 if(!state.players.some(p=>p.id===id&&p.connected)||state.phase!=='playing')return;
 if(job===''||MAPS[state.level].objectives.some(o=>o.id===job)){state.claims[id]=job;}
}
export function pingHeist(state:HeistState,id:string){
 const p=state.players.find(p=>p.id===id&&p.connected);if(!p||state.phase!=='playing')return;
 state.pings=state.pings.filter(p=>p.id!==id);state.pings.push({id,x:p.x,z:p.z,until:state.elapsed+8});
}
function latch(state:HeistState,id:string){
 if(!state.completed.includes(id))state.completed.push(id);
 for(const o of MAPS[state.level].objectives)if(o.release===id)delete state.clamps[o.id];
}
function updateInteractions(state:HeistState,inputs:HeistInputMap,dt:number):void {
 const players=activePlayers(state),map=MAPS[state.level];state.holds={};state.jobs={};
 // Select a single nearby interaction per player. No interaction operates through walls.
 const targets=new Map<string,Objective>();
 for(const p of players){
  const input=inputFor(inputs,p.id);
  if(!input.interact||Math.hypot(input.x,input.z)>.15||confrontationFor(state,p.id))continue;
  const target=map.objectives.filter(o=>!state.completed.includes(o.id)&&!(o.kind==='hold'&&o.release&&state.completed.includes(o.release))&&objectiveAvailable(state,o)&&(o.kind!=='assist'||o.role===p.role)&&distance(p,o)<1.5&&interactionReachable(state,p,o)).sort((a,b)=>distance(p,a)-distance(p,b))[0];
  if(target){targets.set(p.id,target);state.jobs[p.id]=target.label;if(target.kind==='hold')(state.holds[target.id]??=[]).push(p.id);}
 }
 for(const o of map.objectives.filter(o=>o.kind==='hold')){
  const cl=state.clamps[o.id];
  if(cl&&!cl.installed&&!state.holds[o.id]?.includes(cl.owner))delete state.clamps[o.id];
  for(const id of state.holds[o.id]??[]){
   if(state.clamps[o.id]?.installed)break;
   if(Object.values(state.clamps).some(c=>c.owner===id&&c.installed))continue;
   const current=state.clamps[o.id]??={owner:id,progress:0,installed:false};
   if(current.owner!==id)continue;
   current.progress=Math.min(1,current.progress+dt/6);
   if(current.progress>=1-1e-8){current.installed=true;state.notice=`Clamp installed: ${o.label}. Complete the paired job to recover it automatically.`;}
  }
 }
 for(const p of players){
  const o=targets.get(p.id);if(!o||o.kind==='hold')continue;
  if(o.hold&&!state.clamps[o.hold]?.installed&&!state.holds[o.hold]?.length)continue;
  if(o.kind==='security'){const seconds=p.role==='lookout'?25:15;state.scannerDisabled=seconds;for(const id of o.sectors??[])state.sectorDisabled[id]=seconds;continue;}
  const bonus=p.role===o.specialty?2:1;
  state.progress[o.id]=Math.min(1,(state.progress[o.id]??0)+dt*bonus/o.seconds);
  if(state.progress[o.id]<1-1e-8)continue;
  latch(state,o.id);if(o.bonus)state.lootValue+=o.bonus;state.notice=`${o.label} complete — route stays open`;
  if(o.kind==='assist'){
   state.credits[o.id]=p.id;state.notice=`${p.name} · ${o.label}: ${o.hint}`;
   if(o.perk==='haul'&&!state.practice)state.remaining+=CREW_PERKS.HAUL_SECONDS;
  }
  if(o.kind==='loot'){
   state.diamondTaken=true;state.cargo.loaded=true;state.cargo.x=p.x;state.cargo.z=p.z;state.cargo.controller=p.id;state.carrierId=p.id;p.carrying=true;
   if(map.cargo!=='cart')state.remaining=Math.min(state.remaining,map.escapeSeconds[Math.max(0,players.length-1)]+(crewPerk(state,'haul')?CREW_PERKS.HAUL_SECONDS:0));
   state.notice=map.cargo==='cart'?'Cart loaded. Hold interact to drive; release to brake. Clamp the next gate from its parking bay.':'Lockdown! Follow the prepared escape route. Bring the cargo and everyone to extraction.';
  }
 }
 // A cart brakes when released; portable cargo stays with its carrier until disconnect.
 if(map.cargo==='cart'&&state.cargo.controller&&!inputFor(inputs,state.cargo.controller).interact){
  const p=players.find(p=>p.id===state.cargo.controller);if(p)p.carrying=false;
  state.cargo.controller=null;state.carrierId=null;
 }
 if(state.cargo.loaded&&!state.cargo.controller){
  const p=players.find(p=>inputFor(inputs,p.id).interact&&distance(p,state.cargo)<1.1&&!targets.has(p.id)&&interactionReachable(state,p,state.cargo));
  if(p){state.cargo.controller=p.id;state.carrierId=p.id;p.carrying=true;}
 }
 const carrier=players.find(p=>p.id===state.cargo.controller);
 if(carrier){state.cargo.x=carrier.x;state.cargo.z=carrier.z;}
 for(const gate of map.gates.filter(g=>g.cartCross)){
  if(state.cargo.loaded&&gateOpen(state,gate)&&((gate.cartCross==='x'&&state.cargo.x>gate.x+1)||(gate.cartCross==='z'&&state.cargo.z>gate.z+1)))latch(state,gate.id);
 }
 state.hacked=state.completed.includes('entry');state.vaultOpen=state.completed.includes('isolate');
 state.hackProgress=state.progress.entry??0;state.overrideProgress=state.progress.isolate??0;
 state.switchHeld=!!state.holds[map.switch===undefined?'':map.objectives.find(o=>o.kind==='hold')!.id]?.length||Object.values(state.clamps).some(c=>c.installed);
 const transportDone=map.cargo!=='cart'||['freight-a','freight-b'].every(id=>state.completed.includes(id));
 const allAtExit=transportDone&&players.length>0&&players.every(p=>distance(p,map.exit)<=3);
 const cargoAtExit=state.cargo.loaded&&distance(state.cargo,map.exit)<=2;
 if(allAtExit&&cargoAtExit&&players.some(p=>inputFor(inputs,p.id).interact&&distance(p,map.exit)<=1.7)){
  state.extractProgress=Math.min(1,state.extractProgress+dt/1.5);
  if(state.extractProgress>=1-1e-8){state.phase='won';state.securedValue=Math.floor(state.lootValue);state.escaped=players.map(p=>p.id);state.campaignEarned+=state.securedValue;awardPayouts(state);state.notice='Entire crew and cargo extracted';}
 }else state.extractProgress=0;
}

export function currentJobs(state:HeistState):Objective[]{
 return MAPS[state.level].objectives.filter(o=>!o.optional&&!state.completed.includes(o.id)&&!(o.release&&state.completed.includes(o.release))&&objectiveAvailable(state,o));
}
export function interactionHint(state:HeistState,p:HeistPlayer):{text:string;progress:number}{
 const map=MAPS[state.level];
 if(state.mission?.kind==='setup'){
  const t=state.mission.targets.filter(t=>!t.done&&distance(p,t)<1.6).sort((a,b)=>distance(p,a)-distance(p,b))[0];
  if(t)return{text:`Hold E · ${t.label}`,progress:t.progress};
  return{text:state.mission.targets.every(t=>t.done)?'Head back to the entry point':'',progress:0};
 }
 if(distance(p,map.exit)<2&&state.cargo.loaded)return {text:'Hold E · Extract with cargo and all connected crew within 3m',progress:state.extractProgress};
 if(state.cargo.controller===p.id&&map.cargo!=='cart')return{text:'Cargo secured · Follow the mint route to extraction',progress:0};
 if(state.cargo.loaded&&distance(p,state.cargo)<1.5)return {text:map.cargo==='cart'?'Hold E + move · Drive cart / release E to brake':'Hold E · Recover cargo, then follow the escape route',progress:0};
 const o=map.objectives.filter(o=>distance(p,o)<1.6&&!state.completed.includes(o.id)&&!(o.release&&state.completed.includes(o.release))).sort((a,b)=>distance(p,a)-distance(p,b))[0];
 if(!o)return {text:'M · Tactical map / C · Crouch through service passages',progress:0};
 if(o.kind==='assist'&&o.role!==p.role)return{text:`${ROLE_NAMES[o.role!]}'s crew job · ${o.label}`,progress:0};
 if(!objectiveAvailable(state,o))return{text:`Needs: ${o.requires.filter(id=>!state.completed.includes(id)).map(id=>map.objectives.find(o=>o.id===id)?.label??id).join(', ')}`,progress:0};
 if(o.kind==='hold')return{text:state.clamps[o.id]?.installed?'Clamp installed · Complete the paired job':`Hold E · ${o.label} / 6s installs clamp`,progress:state.clamps[o.id]?.progress??0};
 if(o.hold&&!state.clamps[o.hold]?.installed&&!state.holds[o.hold]?.length)return{text:'Hold or clamp the paired switch first',progress:state.progress[o.id]??0};
 return{text:`Hold E · ${o.label}`,progress:state.progress[o.id]??0};
}

/** Advance the complete ruleset by dt seconds; updates state in place and returns it. */
export function stepHeist(state: HeistState, inputs: HeistInputMap = new Map(), dt = 1 / 30): HeistState {
  if (state.phase !== "playing") return state;
  const elapsedDt = clamp(finite(dt), 0, 60);
  if (elapsedDt <= 0) return state;
  if(state.recovery>0){state.recovery=Math.max(0,state.recovery-elapsedDt);return state;}
  state.elapsed += elapsedDt;
  if(!state.practice)state.remaining = Math.max(0, state.remaining - elapsedDt);
  state.scannerDisabled = Math.max(0, state.scannerDisabled - elapsedDt);
  for(const id of Object.keys(state.sectorDisabled))state.sectorDisabled[id]=Math.max(0,state.sectorDisabled[id]-elapsedDt);
  decayInternal(state, elapsedDt);

  // The clock is authoritative: an interaction in the same tick that reaches
  // zero cannot complete extraction after the facility has sealed.
  if (state.remaining <= 0) {
    state.phase = "lost";
    state.notice = "Time expired — the facility sealed";
    return state;
  }

  if(MAPS[state.level].cargo==='cart'&&state.cargo.controller&&!inputFor(inputs,state.cargo.controller).interact){
    const p=state.players.find(p=>p.id===state.cargo.controller);if(p)p.carrying=false;
    state.cargo.controller=null;state.carrierId=null;
  }
  // A gate cannot crush or strand an occupied cart when its human holder leaves.
  for(const gate of MAPS[state.level].gates.filter(g=>g.cartCross)){
    const near=state.cargo.loaded&&Math.abs(state.cargo.x-gate.x)<gate.w/2+1&&Math.abs(state.cargo.z-gate.z)<gate.d/2+1;
    const ids=state.gateGrace[gate.id]??=[];
    if(near&&gateOpen(state,gate)&&!ids.includes('cargo'))ids.push('cargo');
    if(!near){const at=ids.indexOf('cargo');if(at>=0)ids.splice(at,1);}
  }
  // Interior emergency egress lets a survivor return to a released switch.
  for(const gate of MAPS[state.level].gates.filter(g=>g.crawl)){
    const ids=state.gateGrace[gate.id]??=[];
    for(const p of activePlayers(state)){
      if(p.z<gate.z-.6&&Math.abs(p.x-gate.x)<gate.w/2&&!ids.includes(p.id))ids.push(p.id);
      if(p.z>gate.z+.8){const at=ids.indexOf(p.id);if(at>=0)ids.splice(at,1);}
    }
  }
  state.pings=state.pings.filter(p=>p.until>state.elapsed);
  const openBeforeMovement=MAPS[state.level].gates.filter(g=>gateOpen(state,g));
  for (const player of activePlayers(state)) {
    // A cornered player stands still while they bluff.
    if (confrontationFor(state, player.id)) { player.vx = 0; player.vz = 0; player.noise = 0; player.interacting = false; continue; }
    movePlayer(state, player, inputFor(inputs, player.id), elapsedDt);
  }
  for(const gate of openBeforeMovement.filter(g=>g.cartCross)){
    const controller=activePlayers(state).find(p=>p.id===state.cargo.controller);
    if(controller&&Math.abs(controller.x-gate.x)<gate.w/2+1&&Math.abs(controller.z-gate.z)<gate.d/2+1){const grace=state.gateGrace[gate.id]??=[];if(!grace.includes('cargo'))grace.push('cargo');}
  }
  if (state.mission?.kind === "setup") updateSetup(state, inputs, elapsedDt);
  else updateInteractions(state, inputs, elapsedDt);
  if (state.phase === "playing") {
    updateGuards(state, inputs, elapsedDt);
    for (const player of activePlayers(state)) if (state.phase === "playing") applyHazards(state, player);
  }

  state.doorOpen = state.hacked;
  state.doorTimer = state.hacked ? 8 : 0;
  state.plates = [state.hacked, state.switchHeld];
  setStage(state);

  if (state.phase === "playing" && activePlayers(state).length < HEIST_CONSTANTS.MIN_PLAYERS) {
    state.phase = "lost";
    state.notice = "Crew disconnected — the run failed before extraction";
  } else if (state.phase === "playing" && state.remaining <= 0) {
    state.phase = "lost";
    state.notice = "Time expired — the facility sealed";
  }
  return state;
}

export function canStartHeist(state: HeistState): boolean {
  const connected = activePlayers(state);
  return state.phase === "lobby" && connected.length >= HEIST_CONSTANTS.MIN_PLAYERS && connected.length <= HEIST_CONSTANTS.MAX_PLAYERS &&
    connected.every((player) => player.ready) && cutsValid(state);
}

export function isValidHeistCuts(state: HeistState): boolean {
  return cutsValid(state);
}


// ─── Security: patrolling guards and sweeping cameras ────────────────────────

function spawnGuards(map: HeistMap): HeistGuard[] {
  const guards: HeistGuard[] = map.guards.map((spec) => {
    const [a, b = a] = spec.route;
    return { id: spec.id, kind: "guard", x: a.x, z: a.z, yaw: Math.atan2(b.x - a.x, b.z - a.z), mode: "patrol", suspicion: 0, target: null, lastSeen: null, timer: 0, waypoint: spec.route.length > 1 ? 1 : 0, moving: false };
  });
  for (const cam of map.cameras) guards.push({ id: cam.id, kind: "camera", x: cam.x, z: cam.z, yaw: cam.yaw, mode: "patrol", suspicion: 0, target: null, lastSeen: null, timer: 0, waypoint: 0, moving: false });
  return guards;
}

const angleDelta = (a: number, b: number) => ((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

/** Alarms cost time and take; the last one locks the facility down. */
function raiseAlarm(state: HeistState, player: HeistPlayer, label: string): void {
  const internal = internalFor(state);
  if ((internal.laserImmunity.get(player.id) ?? 0) > 0) return;
  triggerAlarm(state, player, label);
  internal.laserImmunity.set(player.id, 4);
  if (!state.practice && state.alarms >= state.maxAlarms) {
    state.phase = "lost";
    state.notice = `Alarm ${state.alarms} of ${state.maxAlarms} — the building locked down`;
  }
}

/** Line of sight blocked by walls and closed gates (including crawl hatches). */
function lineClear(state: HeistState, from: { x: number; z: number }, to: { x: number; z: number }, crouched = false): boolean {
  const map = MAPS[state.level];
  // Low cover only hides someone crouching behind it.
  const blockers = [...map.walls.filter((w) => w.kind !== "cover" || crouched), ...gateWalls(state)];
  const length = Math.hypot(to.x - from.x, to.z - from.z), steps = Math.max(2, Math.ceil(length / 0.25));
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = from.x + (to.x - from.x) * t, z = from.z + (to.z - from.z) * t;
    if (blockers.some((w) => circleHitsWall(x, z, 0.02, w))) return false;
  }
  return true;
}

/** 0 when hidden; otherwise how clearly this guard or camera sees the player (0.25..1). */
export function guardVisibility(state: HeistState, guard: HeistGuard, player: HeistPlayer): number {
  if (!player.connected || guard.mode === "stunned") return 0;
  const camera = guard.kind === "camera";
  const dx = player.x - guard.x, dz = player.z - guard.z, d = Math.hypot(dx, dz);
  let range: number = (camera ? GUARD_CONSTANTS.CAMERA_RANGE : player.crouching ? GUARD_CONSTANTS.CROUCH_RANGE : GUARD_CONSTANTS.RANGE) * tuning(state).sight;
  if (player.carrying && !camera) range += 1;
  if (d > range) return 0;
  const fov = camera ? GUARD_CONSTANTS.CAMERA_FOV : GUARD_CONSTANTS.FOV;
  if (Math.abs(angleDelta(Math.atan2(dx, dz), guard.yaw)) > fov / 2) {
    // Bumping into a guard is noticed even outside the cone, unless crouched.
    return !camera && d < 1.2 && !player.crouching ? 0.6 : 0;
  }
  if (!lineClear(state, guard, player, player.crouching)) return 0;
  return clamp(1.15 - d / range, 0.25, 1);
}

/** The guard a player could take down right now, if any. */
export function takedownTarget(state: HeistState, player: HeistPlayer): HeistGuard | null {
  let best: HeistGuard | null = null, bestD = Infinity;
  for (const g of state.guards) {
    if (g.kind !== "guard" || g.mode === "stunned") continue;
    const d = distance(g, player);
    if (d > GUARD_CONSTANTS.TAKEDOWN_RADIUS || d >= bestD) continue;
    if (Math.abs(angleDelta(Math.atan2(player.x - g.x, player.z - g.z), g.yaw)) < GUARD_CONSTANTS.TAKEDOWN_BEHIND) continue;
    best = g; bestD = d;
  }
  return best;
}

function nearestGuard(state: HeistState, point: { x: number; z: number }): HeistGuard | null {
  let best: HeistGuard | null = null;
  for (const g of state.guards) if (g.kind === "guard" && g.mode !== "stunned" && g.mode !== "confront" && (!best || distance(g, point) < distance(best, point))) best = g;
  return best;
}

function investigate(guard: HeistGuard, point: { x: number; z: number }, mode: "suspicious" | "search"): void {
  if (guard.kind !== "guard" || guard.mode === "stunned" || guard.mode === "confront") return;
  if (mode === "suspicious" && guard.mode === "search") return;
  guard.mode = mode;
  guard.lastSeen = { x: point.x, z: point.z };
  guard.timer = mode === "search" ? 8 : 0;
  guard.suspicion = Math.max(guard.suspicion, mode === "search" ? 0.5 : 0.35);
  guardPaths(guard).length = 0;
}

// Guards walk a 0.5 m grid with BFS so they route around walls and closed gates.
const NAV_CELL = 0.5, NAV_COLS = 64, NAV_ROWS = 48;
const staticNav = new Map<number, Uint8Array>();
const pathKey = new WeakMap<HeistGuard, { x: number; z: number }[]>();
function guardPaths(guard: HeistGuard) { let p = pathKey.get(guard); if (!p) { p = []; pathKey.set(guard, p); } return p; }
const cellCenter = (i: number, j: number) => ({ x: -16 + (i + 0.5) * NAV_CELL, z: -12 + (j + 0.5) * NAV_CELL });
function staticGrid(level: number): Uint8Array {
  let grid = staticNav.get(level);
  if (grid) return grid;
  const map = MAPS[level], r = 0.3;
  grid = new Uint8Array(NAV_COLS * NAV_ROWS);
  for (let j = 0; j < NAV_ROWS; j++) for (let i = 0; i < NAV_COLS; i++) {
    const { x, z } = cellCenter(i, j);
    const onFloor = [[-r, -r], [-r, r], [r, -r], [r, r]].every(([dx, dz]) => map.floors.some((f) => Math.abs(x + dx - f.x) <= f.w / 2 && Math.abs(z + dz - f.z) <= f.d / 2));
    const blocked = !onFloor || map.walls.some((w) => circleHitsWall(x, z, r, w)) || map.props.some((p) => circlesOverlap(x, z, r, p.x, p.z, p.radius));
    grid[j * NAV_COLS + i] = blocked ? 1 : 0;
  }
  staticNav.set(level, grid);
  return grid;
}
function findGuardPath(state: HeistState, from: { x: number; z: number }, to: { x: number; z: number }): { x: number; z: number }[] {
  const grid = staticGrid(state.level), closed = gateWalls(state);
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < NAV_COLS && j < NAV_ROWS && !grid[j * NAV_COLS + i] && !closed.some((g) => { const c = cellCenter(i, j); return circleHitsWall(c.x, c.z, 0.3, g); });
  const cell = (p: { x: number; z: number }) => ({ i: clamp(Math.floor((p.x + 16) / NAV_CELL), 0, NAV_COLS - 1), j: clamp(Math.floor((p.z + 12) / NAV_CELL), 0, NAV_ROWS - 1) });
  const nearestFree = (c: { i: number; j: number }) => { if (free(c.i, c.j)) return c; for (let ring = 1; ring < 6; ring++) for (let dj = -ring; dj <= ring; dj++) for (let di = -ring; di <= ring; di++) if (free(c.i + di, c.j + dj)) return { i: c.i + di, j: c.j + dj }; return null; };
  const start = nearestFree(cell(from)), goal = nearestFree(cell(to));
  if (!start || !goal) return [];
  const startKey = start.j * NAV_COLS + start.i, goalKey = goal.j * NAV_COLS + goal.i;
  const previous = new Int32Array(NAV_COLS * NAV_ROWS).fill(-1);
  previous[startKey] = startKey;
  const queue = [startKey];
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head];
    if (key === goalKey) break;
    const i = key % NAV_COLS, j = Math.floor(key / NAV_COLS);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const ni = i + di, nj = j + dj, next = nj * NAV_COLS + ni;
      if (!free(ni, nj) || previous[next] !== -1) continue;
      if (di && dj && (!free(i + di, j) || !free(i, j + dj))) continue;
      previous[next] = key;
      queue.push(next);
    }
  }
  if (previous[goalKey] === -1) return [];
  const path: { x: number; z: number }[] = [];
  for (let key = goalKey; key !== startKey; key = previous[key]) path.push(cellCenter(key % NAV_COLS, Math.floor(key / NAV_COLS)));
  path.reverse();
  if (path.length) path[path.length - 1] = { x: to.x, z: to.z };
  return path;
}

/** Walk along a (re)planned path; returns true on arrival. */
function walkGuard(state: HeistState, guard: HeistGuard, goal: { x: number; z: number }, speed: number, dt: number, replan: boolean): boolean {
  const path = guardPaths(guard);
  if (distance(guard, goal) < 0.35) { path.length = 0; guard.moving = false; return true; }
  if (replan || !path.length) { path.splice(0, path.length, ...findGuardPath(state, guard, goal)); }
  let budget = speed * dt;
  guard.moving = path.length > 0;
  while (budget > 0 && path.length) {
    const next = path[0], d = distance(guard, next);
    if (d > 0.001) {
      const turn = angleDelta(Math.atan2(next.x - guard.x, next.z - guard.z), guard.yaw);
      guard.yaw += turn * Math.min(1, dt * 9);
    }
    if (d <= budget) { guard.x = next.x; guard.z = next.z; budget -= d; path.shift(); }
    else { guard.x += (next.x - guard.x) / d * budget; guard.z += (next.z - guard.z) / d * budget; budget = 0; }
  }
  return distance(guard, goal) < 0.35;
}

function face(guard: HeistGuard, point: { x: number; z: number }, dt: number, rate = 6): void {
  guard.yaw += angleDelta(Math.atan2(point.x - guard.x, point.z - guard.z), guard.yaw) * Math.min(1, dt * rate);
}

/** Seconds into a confrontation → needle position 0..1 sweeping back and forth. */
export function talkNeedle(t: number): number {
  return (1 - Math.cos(t * GUARD_CONSTANTS.TALK_NEEDLE_SPEED)) / 2;
}

/** The player's confrontation, if a guard has them cornered right now. */
export function confrontationFor(state: HeistState, playerId: string): Confrontation | undefined {
  return state.confrontations?.find((c) => c.player === playerId);
}

function bust(state: HeistState, player: HeistPlayer, reason: string): void {
  state.phase = "lost";
  state.busted = player.name;
  state.confrontations = [];
  state.notice = `Busted — ${player.name} ${reason}.`;
}

/** A guard whose suspicion fills corners the player: a silent bluff judged on a sweeping needle. Each guard can be bluffed twice, the second time with a much narrower window. */
function confront(state: HeistState, guard: HeistGuard, player: HeistPlayer): void {
  if ((guard.bluffed ?? 0) >= GUARD_CONSTANTS.BLUFFS_PER_GUARD) { bust(state, player, "was recognised by a guard they had already fooled twice"); return; }
  guard.mode = "confront"; guard.target = player.id; guard.moving = false; guardPaths(guard).length = 0;
  player.vx = 0; player.vz = 0;
  // The green zone sits somewhere new each time, so the bluff can't be pre-timed.
  const seed = [...guard.id].reduce((a, c) => a + c.charCodeAt(0), 0) + Math.floor(state.elapsed * 7);
  const center = 0.25 + ((seed * 0.6180339887) % 1) * 0.5;
  const width = GUARD_CONSTANTS.TALK_WINDOW * tuning(state).talk * (player.role === "lookout" ? 1.35 : 1) * GUARD_CONSTANTS.WARY_WINDOW ** (guard.bluffed ?? 0);
  state.confrontations.push({ guard: guard.id, player: player.id, t: 0, center, width, duration: GUARD_CONSTANTS.TALK_SECONDS });
  state.notice = `${player.name} has been stopped by a guard — talk your way out`;
}

function updateConfrontations(state: HeistState, inputs: HeistInputMap, dt: number): void {
  const internal = internalFor(state);
  for (const c of [...state.confrontations]) {
    const player = state.players.find((p) => p.id === c.player && p.connected);
    const guard = state.guards.find((g) => g.id === c.guard);
    const input = inputFor(inputs, c.player);
    const pressed = input.talk && internal.previousTalk.get(c.player) !== true;
    internal.previousTalk.set(c.player, input.talk);
    c.t += dt;
    const done = () => { state.confrontations = state.confrontations.filter((x) => x !== c); };
    // A teammate knocking the guard out (or a disconnect) ends the standoff.
    if (!player || !guard || guard.mode !== "confront") { done(); continue; }
    if (pressed) {
      // Online clients report when they pressed; accept it within network delay so lag can't cost the bluff.
      const at = input.talkAt >= c.t - 0.45 && input.talkAt <= c.t + 0.05 ? input.talkAt : c.t;
      if (Math.abs(talkNeedle(at) - c.center) <= c.width) {
        done();
        guard.mode = "patrol"; guard.suspicion = 0; guard.target = null; guard.wary = true; guard.bluffed = (guard.bluffed ?? 0) + 1;
        guard.calm = GUARD_CONSTANTS.CALM_SECONDS; guard.timer = 1.2; guard.yaw += Math.PI * 0.6;
        state.talkouts += 1;
        state.notice = guard.bluffed! >= GUARD_CONSTANTS.BLUFFS_PER_GUARD
          ? `${player.name} talked their way out again — that guard won't buy it a third time.`
          : `${player.name} talked their way out. That guard is wary now: one more bluff, and a tighter one.`;
      } else bust(state, player, "fumbled the bluff");
      if (state.phase !== "playing") return;
      continue;
    }
    if (c.t >= c.duration) { bust(state, player, "froze up in front of a guard"); return; }
  }
}

function updateGuards(state: HeistState, inputs: HeistInputMap, dt: number): void {
  if (state.practice) { state.guards = []; return; }
  const players = activePlayers(state), internal = internalFor(state), map = MAPS[state.level];
  // Takedowns first: an unaware guard grabbed from behind is out for a while.
  for (const p of players) {
    const pressed = inputFor(inputs, p.id).takedown, previous = internal.previousTakedown.get(p.id) === true;
    internal.previousTakedown.set(p.id, pressed);
    if (!pressed || previous) continue;
    const g = takedownTarget(state, p);
    if (g) { g.mode = "stunned"; g.timer = tuning(state).stun; g.suspicion = 0; g.target = null; g.moving = false; state.takedowns += 1; state.notice = `${p.name} took down a guard — they'll wake in ${tuning(state).stun} seconds`; }
  }
  updateConfrontations(state, inputs, dt);
  if (state.phase !== "playing") return;
  const free = players.filter((p) => !confrontationFor(state, p.id));
  for (const g of state.guards) {
    if (g.kind === "camera") { updateCamera(state, g, free, dt, map); continue; }
    if (g.mode === "stunned") { g.timer -= dt; g.moving = false; if (g.timer <= 0) { g.mode = "patrol"; g.timer = 0; guardPaths(g).length = 0; } continue; }
    if (g.mode === "confront") {
      const target = players.find((p) => p.id === g.target);
      if (target) face(g, target, dt, 8);
      continue;
    }
    // Just talked down: the guard ignores everyone for a moment while walking off.
    const calm = (g.calm ?? 0) > 0;
    if (calm) g.calm = Math.max(0, (g.calm ?? 0) - dt);
    let seen: HeistPlayer | null = null, clarity = 0;
    if (!calm) for (const p of free) { const v = guardVisibility(state, g, p); if (v > clarity) { clarity = v; seen = p; } }
    if (!seen && !calm) {
      for (const p of free) if (p.noise > 0 && distance(p, g) < p.noise * GUARD_CONSTANTS.HEARING_PER_NOISE * tuning(state).hearing) { investigate(g, p, g.mode === "search" ? "search" : "suspicious"); break; }
    }
    if (seen) {
      const rate = (g.mode === "search" ? GUARD_CONSTANTS.SEARCH_SUSPICION : GUARD_CONSTANTS.SUSPICION) * (g.wary ? 1.4 : 1) * tuning(state).suspicion;
      g.suspicion = Math.min(1, g.suspicion + dt * clarity * rate);
      g.lastSeen = { x: seen.x, z: seen.z };
      if (g.suspicion >= 1) { confront(state, g, seen); if (state.phase !== "playing") return; continue; }
      if (g.mode === "patrol" && g.suspicion > 0.3) { g.mode = "suspicious"; g.timer = 0; guardPaths(g).length = 0; }
      if (g.mode !== "patrol") { face(g, seen, dt); g.moving = false; continue; }
    } else g.suspicion = Math.max(0, g.suspicion - dt * (g.mode === "patrol" ? 0.35 : 0.15));
    if (g.mode === "suspicious" || g.mode === "search") {
      const goal = g.lastSeen ?? g;
      const speed = g.mode === "search" ? GUARD_CONSTANTS.SEARCH_SPEED : GUARD_CONSTANTS.INVESTIGATE_SPEED;
      if (walkGuard(state, g, goal, speed, dt, false)) {
        g.yaw += dt * 1.6 * (Math.sin(state.elapsed * 0.9) > 0 ? 1 : -1);
        g.timer += g.mode === "suspicious" ? dt : -dt;
        if ((g.mode === "suspicious" && g.timer > 4 && g.suspicion < 0.05) || (g.mode === "search" && g.timer <= 0)) { g.mode = "patrol"; g.suspicion = Math.min(g.suspicion, 0.2); g.timer = 0; g.lastSeen = null; guardPaths(g).length = 0; }
      }
      continue;
    }
    // Patrol the route loop, pausing to look around at each corner.
    const route = map.guards.find((spec) => spec.id === g.id)?.route ?? [g];
    if (g.timer > 0) { g.timer -= dt; g.moving = false; g.yaw += Math.sin(state.elapsed * 1.3) * dt * 1.2; continue; }
    const goal = route[g.waypoint % route.length];
    if (walkGuard(state, g, goal, GUARD_CONSTANTS.PATROL_SPEED, dt, false)) { g.waypoint = (g.waypoint + 1) % route.length; g.timer = GUARD_CONSTANTS.WAYPOINT_PAUSE; }
  }
}

function updateCamera(state: HeistState, cam: HeistGuard, players: HeistPlayer[], dt: number, map: HeistMap): void {
  const spec = map.cameras.find((c) => c.id === cam.id);
  if (!spec) return;
  if (state.scannerDisabled > 0 || crewPerk(state, "cameras")) { cam.mode = "stunned"; cam.suspicion = 0; return; }
  if (cam.mode === "stunned") cam.mode = "patrol";
  if (cam.mode === "alert") { cam.timer -= dt; if (cam.timer <= 0) { cam.mode = "patrol"; cam.suspicion = 0; } return; }
  cam.yaw = spec.yaw + Math.sin(state.elapsed * (spec.speed ?? GUARD_CONSTANTS.CAMERA_SWEEP_SPEED) + spec.x) * spec.sweep;
  let seen: HeistPlayer | null = null, clarity = 0;
  for (const p of players) { const v = guardVisibility(state, cam, p); if (v > clarity) { clarity = v; seen = p; } }
  if (!seen) { cam.suspicion = Math.max(0, cam.suspicion - dt * 0.4); cam.mode = "patrol"; return; }
  cam.mode = "suspicious";
  cam.suspicion = Math.min(1, cam.suspicion + dt * clarity * GUARD_CONSTANTS.CAMERA_SUSPICION * tuning(state).suspicion);
  cam.lastSeen = { x: seen.x, z: seen.z };
  if (cam.suspicion >= 1) {
    cam.mode = "alert"; cam.timer = 5;
    raiseAlarm(state, seen, "got caught on camera");
    const responder = nearestGuard(state, seen);
    if (responder) investigate(responder, seen, "search");
  }
}

/** How far a sight line travels along `angle` before a wall or closed gate stops it (for drawing vision cones). */
export function visionReach(state: HeistState, from: { x: number; z: number }, angle: number, range: number): number {
  const map = MAPS[state.level];
  const blockers = [...map.walls.filter((w) => w.kind !== "cover"), ...gateWalls(state)];
  const dx = Math.sin(angle), dz = Math.cos(angle);
  for (let d = 0.2; d < range; d += 0.2) {
    const x = from.x + dx * d, z = from.z + dz * d;
    if (blockers.some((w) => circleHitsWall(x, z, 0.02, w)) || !map.floors.some((f) => Math.abs(x - f.x) <= f.w / 2 + 0.3 && Math.abs(z - f.z) <= f.d / 2 + 0.3)) return d;
  }
  return range;
}

/** The sight range the renderer should draw for a guard or camera. */
export function guardRange(guard: HeistGuard): number {
  return guard.kind === "camera" ? GUARD_CONSTANTS.CAMERA_RANGE : GUARD_CONSTANTS.RANGE;
}
