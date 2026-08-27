// Cafeteria small-talk — Rudy OS edition.
//
// The cast are clones of Rudy wearing different jobs (see cast.ts), so an
// agent's coffee break is an excuse for a one-liner in character. Two kinds:
//   • solo  — one quip shown above a single agent at a break spot
//   • pair  — a two-beat exchange between two agents at the same table
//
// Lines are kept short so they fit the ThoughtBubble (≈MAX_WIDTH). Character
// keys match OfficeCharacterName; anyone without bespoke lines falls back to the
// shared GENERIC pool so the floor never feels empty.

import type { OfficeCharacterName } from './cast';

/** Where an agent is lingering — picks a contextual line pool. */
export type BreakSpot = 'coffee' | 'vending' | 'snack' | 'table';

const pick = <T,>(arr: readonly T[], seed: number): T =>
  arr[((seed % arr.length) + arr.length) % arr.length];

// ─── solo lines, by spot ─────────────────────────────────────────────────────

const COFFEE: readonly string[] = [
  'is this… decaf?? who did this',
  "we're out of beans again",
  'first cup of the day. and the fifth.',
  'the coffee here is basically a hug',
  'who took my mug?',
  'one more cup, then the refactor',
  'espresso: the original hotfix',
];

const VENDING: readonly string[] = [
  'the machine ate my dollar',
  'B4… please be the pretzels',
  'it’s stuck. classic.',
  'shaking it. gently. respectfully.',
  'one (1) emotional-support snack',
  'A1 again. living dangerously.',
  'vending machine: also needs a retry policy',
];

const SNACK: readonly string[] = [
  'who finished the chips??',
  'just a little treat',
  'these are everyone’s? cool cool cool',
  'second breakfast',
  'snack-driven development',
  'brain food. allegedly.',
];

const TABLE: readonly string[] = [
  'big day. lots of meetings.',
  'just five more minutes',
  'did you see the standup notes?',
  'pretending to read my notes',
  'I needed this break, honestly',
  'do NOT tell the boss I’m in here',
  'the build can run without me. right?',
  'we are all the same guy. it’s fine.',
];

const SPOT_POOL: Record<BreakSpot, readonly string[]> = {
  coffee: COFFEE, vending: VENDING, snack: SNACK, table: TABLE,
};

// ─── character flavour — overrides the generic pool when present ─────────────

const BY_CHARACTER: Partial<Record<OfficeCharacterName, readonly string[]>> = {
  rudy:  ['I’m the original. allegedly.', 'every one of you is me. be nice to me.', 'no meetings before coffee. that’s the rule.', 'who approved fifteen of me?'],
  theo:  ['works on my machine', 'shipping it. tests can catch up.', 'just one more feature flag', 'headphones on = do not deploy'],
  sam:   ['is it on? is it plugged in?', 'the pager is quiet. suspicious.', 'I restarted it. it’s fine now.', 'hard hat stays ON in here'],
  ines:  ['that’s not the right grey', 'four pixels off. I can feel it.', 'the beret is load-bearing', 'can we talk about that border radius'],
  lena:  ['it passed. run it again.', 'I found a bug in the coffee machine', 'edge case: the cup is empty', 'QA never sleeps. QA naps.'],
  kofi:  ['who left this tab logged in?', 'rotate your keys. all of them.', 'trust no one. especially the fridge.', 'I can hear the mic. I’m always on the mic.'],
  ravi:  ['p95 latency of this queue is bad', 'statistically, it’s my turn for coffee', 'the dashboard says snack', 'bow tie: also a data point'],
  noor:  ['I should write that up…', 'docs first, coffee second', 'nobody reads the README. I know.', 'the scarf is for the drafts'],
  wren:  ['the rack is warm. good.', 'cables are just infra spaghetti', 'the beanie is for the server room', 'dns. it’s always dns.'],
  mara:  ['moving that to next sprint', 'could we align on the coffee?', 'roadmap says: break', 'the lanyard opens no doors, fyi'],
  yuki:  ['the model is thinking. so am I.', 'training run is at 40%. vibes are at 60%.', 'visor down. eval mode.', 'it hallucinated a snack'],
  jonah: ['the crown was a gift. from me.', 'signing the checks. with my eyes.', 'expense the pretzels', 'I delegate my breaks'],
  zoe:   ['tap tap swipe, coffee', 'the app works offline. like me right now.', 'one earbud in, always', 'small screen, big snack'],
  mateo: ['on call. on coffee. on it.', 'the incident can wait four minutes', 'this mug is the status page', 'paged during the snack. again.'],
  ayo:   ['is this where the interns sit?', 'learning SO much (about the vending machine)', 'cap backwards = focus mode', 'did I do that right?'],
};

/** A solo break-room line. Character flavour ~60% of the time, else the line
 *  fits the spot the agent is standing at. `seed` keeps it deterministic per
 *  call site (avoids Math.random, which Pixi/Electron CSP-safe code prefers). */
export function pickSoloLine(character: OfficeCharacterName, spot: BreakSpot, seed: number): string {
  const flavour = BY_CHARACTER[character];
  if (flavour && seed % 5 < 3) return pick(flavour, Math.floor(seed / 5));
  return pick(SPOT_POOL[spot], seed);
}

// ─── paired exchanges (two agents at one table) ──────────────────────────────
//
// Each exchange is a list of beats that ALTERNATE between the two agents:
// beat[0] = the speaker who sat down, beat[1] = their table-mate, beat[2] =
// speaker again, and so on. The director plays them out one beat at a time.
// Lines are trimmed to fit the thought cloud; longer ones auto-truncate.

type Exchange = readonly string[];

// Generic banter — works between any two agents (they're all Rudy, after all).
const EXCHANGES: readonly Exchange[] = [
  ['we look exactly the same.', 'I have a hat.', '...fair.'],
  ['standup ran 40 minutes.', 'could’ve been an email.'],
  ['is the build green yet?', '...don’t look.'],
  ['who reply-all’d everyone?', 'we don’t talk about it.'],
  ['works on my machine.', 'we have the same machine.', 'then it works.'],
  ['did you test it?', 'I tested it in my head.', 'and?', 'it passed.'],
  ['merge conflict.', 'with who?', 'with me. from yesterday.'],
  ['is a hot dog a sandwich?', 'it is.', 'I know, right?'],
  ['I named the variable `thing2`.', 'I know. I found it.', '...sorry.'],
  ['coffee before review.', 'review before coffee.', 'we are not the same.', 'we literally are.'],
  ['the prod alert was a test.', 'whose test?', '...mine.'],
  ['I wrote docs.', 'for what?', 'the docs.', 'of course.'],
  ['can you look at my PR?', 'which one?', 'all of them.', 'no.'],
  ['do you ever sleep?', 'I’m an agent.', 'that’s a no.'],
  ['rename main to master?', 'absolutely not.', 'kidding. mostly.'],
  ['who broke the build?', '*looks at camera*', 'so, you.'],
  ['I shipped on a Friday.', 'why.', 'it felt right.', 'it never is.'],
  ['tabs or spaces?', 'yes.', '...yes.'],
  ['the boss says hi.', 'the boss is also us.', 'then hi.'],
  ['any plans after this?', 'the queue.', 'glamorous.'],
  ['I deleted the cache.', 'and?', 'it’s faster now.', 'it always is.'],
  ['rubber duck session?', 'I AM the rubber duck.', 'quack, then.'],
  ['is it DNS?', 'it’s always DNS.', 'it was DNS.'],
  ['the vending machine has a bug.', 'file an issue.', 'it ate the issue.'],
  ['I rotated the keys.', 'all of them?', 'including yours.', '...thanks?'],
  ['how many tabs do you have open?', 'yes.'],
  ['the test was flaky.', 'the test was right.', '...the test was right.'],
  ['did you commit?', 'emotionally.', 'git, I meant.', 'also yes.'],
  ['one more refactor.', 'you said that at 9.', 'and I meant it.'],
  ['coffee run?', 'I’m the one who runs.', 'then run.'],
  ['the roadmap moved.', 'where?', 'next sprint.', 'always next sprint.'],
  ['I found the bug.', 'where?', 'in the coffee machine.', 'priority one.'],
  ['retro in five.', 'what went well?', 'this snack.', 'action item: more snack.'],
  ['I benchmarked the toaster.', 'and?', 'p99 is unacceptable.'],
  ['did the model hallucinate?', 'it invented a holiday.', 'I’m taking it off.'],
  ['design review?', 'it’s four pixels off.', 'nobody will notice.', 'I noticed.'],
];

// Keyed off the SPEAKER so, when the right character sits down first, they get
// to open with their signature bit.
const KEYED_EXCHANGES: Partial<Record<OfficeCharacterName, Exchange>> = {
  rudy:  ['every one of you is me.', 'so who gets the credit?', 'me.'],
  theo:  ['shipping it.', 'did you test it?', 'shipping it.'],
  sam:   ['did you try turning it off and on?', 'it’s a coffee mug.', 'did you try, though?'],
  ines:  ['that grey is wrong.', 'it’s the same grey.', 'it is NOT.'],
  lena:  ['it passed.', 'great.', 'run it again.'],
  kofi:  ['who are you?', 'we sit next to each other.', 'badge, please.'],
  ravi:  ['statistically.', 'here we go.', 'it’s my turn for coffee.'],
  noor:  ['I wrote it down.', 'nobody reads it.', 'I’ll write that down too.'],
  wren:  ['it’s DNS.', 'you don’t know that yet.', 'it’s DNS.'],
  mara:  ['quick sync?', 'it’s a break.', 'quick break sync?'],
  yuki:  ['the model says hi.', 'tell it hi back.', 'it already knew.'],
  jonah: ['expense it.', 'it’s a pretzel.', 'expense the pretzel.'],
  zoe:   ['does it work on mobile?', 'it’s a sandwich.', 'does it, though?'],
  mateo: ['I’m on call.', 'you’re on break.', 'on call, on break.'],
  ayo:   ['is this the interns’ table?', 'we don’t have interns.', '...then why am I here?'],
};

/** A multi-beat exchange for two agents sharing a table. Beats alternate:
 *  index 0 = `speaker`, 1 = the table-mate, 2 = speaker, … */
export function pickExchange(speaker: OfficeCharacterName, seed: number): Exchange {
  const keyed = KEYED_EXCHANGES[speaker];
  if (keyed && seed % 4 === 0) return keyed;
  return pick(EXCHANGES, seed);
}
