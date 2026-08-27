/**
 * The Settings hero card's remote payload.
 *
 * Lives as JSON in this repo and is fetched at runtime, so plan copy and
 * sponsors can change without shipping a build. It is DATA, never markup — that
 * distinction is the whole security story here:
 *
 *   - every field is rendered by React as a text node, so it is escaped; there is
 *     no `dangerouslySetInnerHTML` anywhere on this path and adding one would
 *     turn a config file into a script-injection surface;
 *   - URLs are validated to https and opened through the existing `openExternal`
 *     bridge, which independently refuses anything that is not https;
 *   - strings are LENGTH-CAPPED, because the failure mode of unbounded remote
 *     text is not a security hole but a wrecked layout in a dialog the user
 *     cannot then use;
 *   - unknown fields are ignored and a malformed payload falls back to the baked
 *     defaults, so a bad edit degrades to "looks like it always did" rather than
 *     to an empty or broken card.
 *
 * The parse is deliberately total: `parseHeroPayload` never throws and always
 * returns something renderable.
 */

export interface HeroPlan {
  label: string;
  blurb: string;
  /** Rendered as a button only when present AND https. */
  upgrade?: { label: string; url: string };
}

export interface HeroSponsor {
  name: string;
  blurb: string;
  url: string;
}

export interface HeroPayload {
  plan: HeroPlan;
  /** Null renders nothing — never a "your logo here" placeholder. */
  sponsor: HeroSponsor | null;
  /** Optional one-line notice (an incident, a migration heads-up). */
  notice: string | null;
}

/** What ships in the binary. Also the fallback whenever the fetch or the parse
 *  fails, so the card is never empty and never waits on the network to render. */
export const DEFAULT_HERO: HeroPayload = {
  plan: {
    // The chip next to the wordmark names the PLAN, not the app — the wordmark
    // is right beside it, so repeating "Rudy OS" read as a stutter.
    label: 'Free',
    blurb: 'Your office, your machine, your keys. Every agent runs locally in your folders. Nothing metered, nothing upsold.'
  },
  sponsor: null,
  notice: null
};

const MAX = { label: 24, blurb: 240, name: 48, notice: 160, url: 300 };

function str(v: unknown, cap: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
}

/** https only. `openExternal` enforces this again at the bridge; doing it here
 *  too means a bad URL never even renders as a clickable affordance. */
function httpsUrl(v: unknown): string | null {
  const s = str(v, MAX.url);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

/**
 * Turn whatever came off the network into a renderable payload. Any field that
 * fails validation is dropped back to its default rather than failing the whole
 * card — a broken sponsor entry should not cost the user their plan line.
 */
export function parseHeroPayload(raw: unknown): HeroPayload {
  if (!raw || typeof raw !== 'object') return DEFAULT_HERO;
  const o = raw as Record<string, unknown>;

  const planIn = (o.plan && typeof o.plan === 'object' ? o.plan : {}) as Record<string, unknown>;
  const plan: HeroPlan = {
    label: str(planIn.label, MAX.label) ?? DEFAULT_HERO.plan.label,
    blurb: str(planIn.blurb, MAX.blurb) ?? DEFAULT_HERO.plan.blurb
  };
  const upIn = (planIn.upgrade && typeof planIn.upgrade === 'object' ? planIn.upgrade : null) as Record<string, unknown> | null;
  if (upIn) {
    const label = str(upIn.label, MAX.label);
    const url = httpsUrl(upIn.url);
    // Both or neither: a button with no destination is worse than no button.
    if (label && url) plan.upgrade = { label, url };
  }

  let sponsor: HeroSponsor | null = null;
  const spIn = (o.sponsor && typeof o.sponsor === 'object' ? o.sponsor : null) as Record<string, unknown> | null;
  if (spIn) {
    const name = str(spIn.name, MAX.name);
    const url = httpsUrl(spIn.url);
    if (name && url) {
      sponsor = { name, blurb: str(spIn.blurb, MAX.blurb) ?? '', url };
    }
  }

  return { plan, sponsor, notice: str(o.notice, MAX.notice) };
}
