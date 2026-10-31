import { HEISTS, CREW } from '../../shared/heist-campaign';

/** Per-heist plan: chosen approach, finished setups, hired crew, and results. */
export type HeistPlan = { approach: string; setups: string[]; hacker: string; driver: string; best: number; scores: number };
/** `finished` flips once the final heist has been cleared for the first time. */
export type CampaignSave = { money: number; unlocked: number; finished: boolean; plans: HeistPlan[] };

const KEY = 'laser-campaign-v1';
const freshPlan = (level: number): HeistPlan => ({ approach: HEISTS[level].approaches[0].id, setups: [], hacker: 'dax', driver: 'teo', best: 0, scores: 0 });
export const emptyCampaign = (): CampaignSave => ({ money: 0, unlocked: 0, finished: false, plans: HEISTS.map((_, i) => freshPlan(i)) });

/** Read and sanitise the save; anything unknown or malformed falls back to defaults. */
export function loadCampaign(): CampaignSave {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return emptyCampaign();
    const n = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0);
    return {
      money: n(raw.money),
      unlocked: Math.min(HEISTS.length - 1, n(raw.unlocked)),
      finished: raw.finished === true,
      plans: HEISTS.map((heist, i) => {
        const p = raw.plans?.[i] ?? {}, base = freshPlan(i);
        const crew = (id: unknown, role: string, fallback: string) => (CREW.some((c) => c.id === id && c.role === role) ? (id as string) : fallback);
        return {
          approach: heist.approaches.some((a) => a.id === p.approach) ? p.approach : base.approach,
          setups: Array.isArray(p.setups) ? p.setups.filter((id: unknown) => heist.setups.some((s) => s.id === id)) : [],
          hacker: crew(p.hacker, 'hacker', base.hacker),
          driver: crew(p.driver, 'driver', base.driver),
          best: n(p.best),
          scores: n(p.scores),
        };
      }),
    };
  } catch {
    return emptyCampaign();
  }
}

export function saveCampaign(save: CampaignSave) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* private mode: progress lasts for this session only */ }
}
