/**
 * The heist campaign: each contract is planned like a big score — scout it, pick an approach,
 * run that approach's setup mission, hire a crew, then pull the finale and the getaway.
 * Setup targets sit on the same maps and use the same guards as the finale.
 */

/** Advantages (and costs) the finale starts with. Multipliers stack by multiplying, times by adding. */
export interface FinaleMods {
  /** Multiplies how fast guards grow suspicious. */
  suspicion?: number;
  /** Multiplies the talk-your-way-out green zone. */
  talk?: number;
  /** Extra seconds on the lockdown clock. */
  time?: number;
  /** Seconds the cameras are dark when the finale starts. */
  blackout?: number;
  /** Seconds the laser/searchlight sectors are dark when the finale starts. */
  sectorsOff?: number;
  /** Jobs already done when the crew arrives. */
  preComplete?: string[];
  /** Draw every guard's patrol route on the tactical map. */
  showRoutes?: boolean;
  /** Extra percentage of the take paid to someone outside the crew. */
  extraCut?: number;
}

export interface SetupTarget { id: string; label: string; x: number; z: number; seconds: number }
export interface SetupSpec {
  id: string;
  name: string;
  brief: string;
  /** What completing it gives the finale, in plain words. */
  reward: string;
  targets: SetupTarget[];
  /** Jobs treated as done during the setup so the relevant doors are open. */
  open: string[];
  /** Seconds before the building's shift change ends the setup. */
  time: number;
  mods: FinaleMods;
}
export interface ApproachSpec { id: string; name: string; pitch: string; setup: string; mods: FinaleMods }
export interface HeistSpec {
  level: number;
  codename: string;
  pitch: string;
  /** Optional scouting setup that every approach benefits from. */
  casing: string;
  approaches: ApproachSpec[];
  setups: SetupSpec[];
  getaway: "van" | "helicopter";
}
export interface CrewMember {
  id: string;
  role: "hacker" | "driver";
  name: string;
  /** Percent of the take. */
  cut: number;
  skill: 1 | 2 | 3;
  perk: string;
  /** Hackers: seconds the cameras are looped at the start of the finale. */
  blackout?: number;
  /** Drivers: getaway top speed (m/s) and grip (0..1). */
  top?: number;
  grip?: number;
}

const photo = (id: string, label: string, x: number, z: number): SetupTarget => ({ id, label, x, z, seconds: 1.5 });
const casingReward: FinaleMods = { time: 60, showRoutes: true };
const CASING_TEXT = "+1:00 on the clock and every guard's patrol route marked on your map.";

export const HEISTS: HeistSpec[] = [
  {
    level: 0,
    codename: "The Gilded Knot",
    pitch: "A private collector wants the museum's centrepiece. Get it out the loading dock before the night shift notices it's gone.",
    casing: "museum-case",
    getaway: "van",
    approaches: [
      { id: "quiet", name: "Quiet Night", pitch: "Lift a staff keycard and walk straight in through deliveries.", setup: "museum-keycard", mods: {} },
      { id: "disguise", name: "Night-Guard Disguise", pitch: "Wear a guard's uniform. Guards are slow to suspect you and easy to talk down — cameras aren't fooled.", setup: "museum-uniform", mods: {} },
    ],
    setups: [
      { id: "museum-case", name: "Case the Museum", brief: "Photograph the security desk, the centrepiece and the loading dock, then slip back out the way you came.", reward: CASING_TEXT,
        targets: [photo("desk", "Photograph the security desk", -11.5, -1.2), photo("piece", "Photograph the centrepiece through the loading door", 1.2, -8.6), photo("dock", "Photograph the loading dock", 10.4, -10.3)],
        open: ["entry", "isolate"], time: 300, mods: casingReward },
      { id: "museum-keycard", name: "Lift the Keycard", brief: "The security office lockers hold a staff keycard. Search them and get out unseen.", reward: "The keycard opens the delivery entrance — no hack needed.",
        targets: [{ id: "locker", label: "Search the security lockers", x: -15.2, z: -2, seconds: 3 }], open: ["entry"], time: 240, mods: { preComplete: ["entry"] } },
      { id: "museum-uniform", name: "Borrow a Uniform", brief: "Fresh guard uniforms wait in the laundry cart on the loading dock. The dock camera sweeps the yard.", reward: "Guards grow suspicious 45% slower and the talk-out window is 60% wider.",
        targets: [{ id: "laundry", label: "Take a uniform from the laundry cart", x: 8, z: -9.3, seconds: 3 }], open: ["entry", "isolate"], time: 240, mods: { suspicion: 0.55, talk: 1.6 } },
    ],
  },
  {
    level: 1,
    codename: "Brass Tacks",
    pitch: "The Gilded Exchange moves its bullion on Friday. Tonight the vault is full — take the gold out the freight route.",
    casing: "bank-case",
    getaway: "van",
    approaches: [
      { id: "codes", name: "Vault Codes", pitch: "Copy the vault codes from records. Both authorizations are done before you arrive.", setup: "bank-codes", mods: {} },
      { id: "inside", name: "Inside Man", pitch: "Bribe the night manager: the cameras loop for two minutes and staff look away. He wants 10% of the take.", setup: "bank-bribe", mods: { extraCut: 10 } },
    ],
    setups: [
      { id: "bank-case", name: "Case the Exchange", brief: "Photograph the security offices, the records room and the freight bay, then leave through the banking hall.", reward: CASING_TEXT,
        targets: [photo("offices", "Photograph the security offices", -12, -6), photo("records", "Photograph the records room", 6, -6), photo("freight", "Photograph the freight bay", -10, -7.8)],
        open: ["entry", "isolate"], time: 300, mods: casingReward },
      { id: "bank-codes", name: "Copy the Codes", brief: "The vault codes sit in the records room's terminal. The records clerk walks that room all night.", reward: "Both vault authorizations are already done in the finale.",
        targets: [{ id: "codes", label: "Copy the vault codes", x: 4.7, z: -6.3, seconds: 4 }], open: ["entry"], time: 240, mods: { preComplete: ["auth-west", "auth-east"] } },
      { id: "bank-bribe", name: "Bribe the Manager", brief: "Leave the envelope on the night manager's desk in the security offices without being seen doing it.", reward: "Cameras are looped for the first two minutes and guards are 15% slower to suspect you.",
        targets: [{ id: "envelope", label: "Leave the envelope", x: -9.5, z: -0.6, seconds: 2 }], open: ["entry"], time: 240, mods: { blackout: 120, suspicion: 0.85 } },
    ],
  },
  {
    level: 2,
    codename: "Glass Ceiling",
    pitch: "A power core worth a small country sits in a rooftop vault. Take it across the roofs to a waiting helicopter.",
    casing: "sky-case",
    getaway: "helicopter",
    approaches: [
      { id: "jammer", name: "Signal Jammer", pitch: "Plant jammers on the roof relays. Cameras and searchlights stay dark for the first two and a half minutes.", setup: "sky-jammers", mods: {} },
      { id: "maintenance", name: "Maintenance Crew", pitch: "Steal maintenance passes. You walk in through the shutter and guards treat you as staff — until they look twice.", setup: "sky-passes", mods: {} },
    ],
    setups: [
      { id: "sky-case", name: "Scope the Tower", brief: "Photograph the helipad, the perimeter catwalk and the vault roof, then get back to the arrival roof.", reward: CASING_TEXT,
        targets: [photo("pad", "Photograph the helipad", -10, -6.5), photo("catwalk", "Photograph the catwalk", -2, -6.2), photo("vault", "Photograph the vault roof", 8, -8.6)],
        open: ["entry"], time: 300, mods: casingReward },
      { id: "sky-jammers", name: "Plant the Jammers", brief: "Clip jammers to the arrival-roof relay and the helipad relay.", reward: "Cameras and searchlights are dark for the first 2:30 of the finale.",
        targets: [{ id: "relay-a", label: "Plant a jammer on the arrival relay", x: -13.8, z: 9.4, seconds: 3 }, { id: "relay-b", label: "Plant a jammer on the helipad relay", x: -9, z: -9, seconds: 3 }],
        open: ["entry"], time: 240, mods: { blackout: 150, sectorsOff: 150 } },
      { id: "sky-passes", name: "Steal the Passes", brief: "The maintenance crew left their passes on the service-return walkway.", reward: "The maintenance shutter is open and guards are 25% slower to suspect you.",
        targets: [{ id: "passes", label: "Grab the maintenance passes", x: -9, z: 2.5, seconds: 3 }], open: [], time: 240, mods: { preComplete: ["entry"], suspicion: 0.75 } },
    ],
  },
];

export const CREW: CrewMember[] = [
  { id: "wren", role: "hacker", name: "Wren Okafor", cut: 12, skill: 3, blackout: 90, perk: "Loops every camera for 1:30 at the start." },
  { id: "dax", role: "hacker", name: "Dax Mirel", cut: 8, skill: 2, blackout: 60, perk: "Loops every camera for 1:00 at the start." },
  { id: "lou", role: "hacker", name: "Lou Benning", cut: 4, skill: 1, blackout: 30, perk: "Loops the cameras for 30 seconds. Cheap." },
  { id: "rosa", role: "driver", name: "Rosa Vance", cut: 12, skill: 3, top: 34, grip: 1, perk: "Fastest van, sticks to the road." },
  { id: "teo", role: "driver", name: "Teo Marsh", cut: 8, skill: 2, top: 29, grip: 0.85, perk: "Solid wheelman." },
  { id: "kip", role: "driver", name: "Kip Daley", cut: 4, skill: 1, top: 24, grip: 0.7, perk: "Slow and slides about. Cheap." },
];

export const heistFor = (level: number) => HEISTS.find((h) => h.level === level)!;
export const setupById = (heist: HeistSpec, id: string) => heist.setups.find((s) => s.id === id)!;
export const crewById = (id: string) => CREW.find((c) => c.id === id);

/** Everything the finale starts with: approach, finished setups and the hired crew. */
export function finaleMods(heist: HeistSpec, approachId: string, setupsDone: readonly string[], crew: readonly string[]): FinaleMods {
  const approach = heist.approaches.find((a) => a.id === approachId) ?? heist.approaches[0];
  const parts: FinaleMods[] = [approach.mods, ...heist.setups.filter((s) => setupsDone.includes(s.id) && (s.id === heist.casing || s.id === approach.setup)).map((s) => s.mods)];
  const hacker = crew.map(crewById).find((c) => c?.role === "hacker");
  if (hacker?.blackout) parts.push({ blackout: hacker.blackout });
  const out: FinaleMods = {};
  for (const m of parts) {
    if (m.suspicion) out.suspicion = (out.suspicion ?? 1) * m.suspicion;
    if (m.talk) out.talk = (out.talk ?? 1) * m.talk;
    if (m.time) out.time = (out.time ?? 0) + m.time;
    if (m.blackout) out.blackout = Math.max(out.blackout ?? 0, m.blackout);
    if (m.sectorsOff) out.sectorsOff = Math.max(out.sectorsOff ?? 0, m.sectorsOff);
    if (m.preComplete) out.preComplete = [...new Set([...(out.preComplete ?? []), ...m.preComplete])];
    if (m.showRoutes) out.showRoutes = true;
    if (m.extraCut) out.extraCut = (out.extraCut ?? 0) + m.extraCut;
  }
  return out;
}

/** Can the finale start: the chosen approach's setup is done. */
export function finaleReady(heist: HeistSpec, approachId: string, setupsDone: readonly string[]): boolean {
  const approach = heist.approaches.find((a) => a.id === approachId);
  return !!approach && setupsDone.includes(approach.setup);
}
