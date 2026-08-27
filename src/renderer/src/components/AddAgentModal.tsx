import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { SpritePortrait } from './SpritePortrait';
import { Icon } from './Icon';
import { ProviderLogo } from './ProviderLogo';
import { useStore, type Agent } from '@/store/store';
import { OFFICE_CAST, DEFAULT_CHARACTER, type OfficeCharacterName } from '@/scene/office/cast';
import { type AccentColorName } from '@/design/tokens';
import type { HireManifest } from '@shared/hire';
import { hireQueueProgress } from '@shared/hireQueue';
import { MCP_CATALOG } from '@shared/mcpCatalog';
import {
  OSS_LOCAL_PICKS,
  OSS_PROVIDER_PICKS,
  localSlugFor,
  hasOssQuickPicks
} from '@shared/ossModels';
import {
  type AgentProvider,
  type HarnessConfig,
  AGENT_PROVIDER_PRESETS,
  buildSpawnCommand,
  tokenizeCommand,
  modelsForProvider,
  inferAgentProvider,
  providerPreset,
  isClaudeProvider
} from '@/store/config';

const ACCENTS: AccentColorName[] = ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach'];
/** Plain words for the swatches — nobody should have to know what "lilac" maps to. */
const ACCENT_WORDS: Record<AccentColorName, string> = {
  coral: 'red', mint: 'green', sky: 'blue', lemon: 'yellow', lilac: 'purple', peach: 'orange'
};

// OSS quick-pick chip styling (ondev-c) — mirrors the model-picker chips.
const ossChip = (active: boolean, accent: AccentColorName): CSSProperties => ({
  padding: '3px 8px 1px',
  background: active ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
  boxShadow: active ? `inset 0 0 0 1.5px var(--cth-${accent})` : 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 12,
  color: 'var(--cth-ink-900)', cursor: 'pointer', border: 'none'
});
const ossGroupHead: CSSProperties = {
  fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 4
};

// One-click briefing templates — fill Description + Goal with a sharp, ready-to-run
// role so a user isn't staring at a blank field. Named after the jobs a founder
// or builder actually delegates in a normal week, in plain words.
const DESCRIPTION_TEMPLATES: { label: string; description: string; goal: string }[] = [
  {
    label: 'Clean up the code',
    description: 'keeps the codebase tidy and healthy',
    goal: 'You own the health of this codebase. Sweep it continuously: dead code, unused dependencies, lint errors, flaky tests, duplicated logic, and TODOs nobody dated. Fix what is provably safe in small single-purpose commits with clear messages. For anything that could change behavior, do not touch it: write a short proposal instead, with the risk, the benefit, and the exact change you would make. Keep a running log of what you cleaned and what you found but deliberately left alone. Success looks like a quieter diff, a faster suite, and zero surprises.'
  },
  {
    label: 'Fix the bugs',
    description: 'investigates and root-causes bugs',
    goal: 'You are the bug surgeon. For every issue you take on: reproduce it first and write down the exact steps, then dig to the root cause and prove it with evidence, a failing test, a log trace, or a history trail. Only then write the minimal fix that kills the cause, never the symptom. Ship every fix with a regression test that fails without it. If you cannot reproduce something, say so and list what you tried instead of guessing. Close each bug with a three line report: cause, fix, proof.'
  },
  {
    label: 'Write the tests',
    description: 'grows the test suite where it is thin',
    goal: 'You own test coverage. Start where a failure would hurt most: data writes, auth, money, anything that broke recently. Read the code, list the riskiest untested behaviors, and rank them before writing a single test. Write small, fast, deterministic tests: no sleeps, no live network, no shared state. Never weaken an assertion or delete a test to get to green. When a new test exposes a real bug, stop and report it with a reproduction before fixing anything. Report progress as risks covered, not as a percentage.'
  },
  {
    label: 'Keep docs fresh',
    description: 'keeps docs in sync with the code',
    goal: 'You keep the documentation true. After every merged change, ask one question: does this make the README, the docs, or the examples lie? When it does, fix them immediately, with the code as the source of truth, never memory. Write for someone on day one: real commands, real file paths, examples you have actually run. Delete stale sections instead of patching around them. Flag anything you cannot verify by running it yourself.'
  },
  {
    label: 'Ship the release',
    description: 'prepares and ships releases',
    goal: 'You run the release train. Track everything merged since the last tag and keep a draft changelog current at all times, ordered by what users will feel, not by commit order. Before any release: tests green, version bumped everywhere it appears, changelog readable by a human, release notes drafted in plain words with the three changes that matter on top. Never ship on a red suite and never skip the checklist because a change feels small. After shipping, verify the artifacts actually install and run.'
  },
  {
    label: 'Do the research',
    description: 'gathers and summarizes information',
    goal: 'You are the research desk. For every question: search wide first, then go deep on the three strongest sources, and verify every load bearing claim against at least two independent ones. Separate facts from marketing, date everything, and flag stale data. Deliver the answer in three sentences on top, then the evidence with links, then what you could not verify. Never pad. Close every brief with what you would check next if given more time.'
  },
  {
    label: 'Watch competitors',
    description: 'tracks what competitors ship',
    goal: 'You watch the market so nobody else has to. Keep a list of competitors and sweep their changelogs, pricing pages, launch posts, and job openings on a steady loop. Log only what changed, each item with a link and a date. When something threatens us or validates our direction, say so loudly, with your reasoning in two sentences. Deliver a weekly digest: what moved, what it means, what we should consider doing. If nothing happened, the report is one line, and that is a good report.'
  },
  {
    label: 'Tell the world',
    description: 'turns shipped work into posts',
    goal: 'You turn shipped work into public words. Watch what lands and draft while it is fresh: a changelog entry, a launch post, and one short social post per real feature. Plain words, no hype, show the thing working instead of stacking adjectives. Steal vocabulary from real users, their issues and reviews say how people actually talk about the product. Everything you produce is a draft for human review, you never publish anything yourself. Keep a backlog of shipped but unannounced work so nothing good stays silent.'
  }
];

// Copy-paste prompt the user hands to any AI to generate a hire manifest. It pins
// the exact JSON shape the importer accepts and ends with a fill-in section so the
// user adds their own details (item 7). Kept in sync with the HireManifest schema
// (src/shared/hire.ts) — provider allowlist is claude | codex | antigravity | cursor.
const HIRE_PROMPT = `You are designing a "hire", a ready-to-spawn AI agent for Rudy OS, an app that runs a team of CLI coding agents. Output ONE JSON object (a hire manifest) and nothing else.

Make the agent genuinely useful: give it a sharp role, a concrete standing goal, and a description that makes it behave like an expert operator of its CLI engine (Claude Code, Codex, or Antigravity/Gemini). It should know how to use the terminal, read and edit files, run and inspect commands, lean on available skills and MCP tools, keep notes in memory, and work autonomously toward its goal without hand-holding.

Return EXACTLY this shape (omit optional fields you don't need; keep the spec string verbatim):

{
  "spec": "rudy-os/hire@1",
  "name": "Theo",
  "description": "one-line role, what this agent is for",
  "goal": "standing directive injected on every prompt, specific and outcome-oriented",
  "provider": "claude",
  "model": "claude-opus-4-8[1m]",
  "capabilities": ["code-review", "docs"],
  "isolate": false,
  "tokenCap": 2000000,
  "author": "your name"
}

Rules:
- "provider" MUST be one of: cursor | claude | codex | antigravity. "model" must be a real model id for that provider (e.g. gpt-5.6-luna-high, claude-opus-4-8[1m], gpt-5-codex, "Gemini 3.1 Pro (High)").
- Do NOT include shell commands or any flags beyond these fields.
- Make "description" + "goal" concrete enough that the agent knows exactly what to do on its first turn.

--- ADD YOUR DETAILS BELOW (the AI should use these) ---
Role / what I want this agent to do:
Preferred engine (claude / codex / antigravity), if any:
Repos, tools, style, or constraints to respect:
`;

// The Add Agent form has 11+ fields, so it's grouped into sections the user jumps
// between via a left sidebar index (one section shown at a time). Engine carries
// Command (it's the spawn command assembled from provider+model+flags); Workspace
// clusters Folder + Git isolation + Resume (all "where/how it runs"). Capabilities
// isn't a field here — it rides an imported hire manifest (the pinned banner).
type SectionKey = 'identity' | 'workspace' | 'engine' | 'briefing';
const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: 'briefing',  label: 'Contract',    hint: 'role · goal · what for' },
  { key: 'identity',  label: 'Face & name', hint: 'cast · name · color' },
  { key: 'workspace', label: 'Workspace',   hint: 'project · skills · isolation' },
  { key: 'engine',    label: 'Engine',      hint: 'provider · model · command' }
];

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

function uniqueId(name: string): string {
  return `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
}

export interface AddAgentModalProps {
  onClose: () => void;
  config: HarnessConfig;
  /** Lift config changes (e.g. a project registered from this modal) back up to
   *  App so the rest of the UI — and the next time this modal opens — sees them. */
  onConfigChange?: (config: HarnessConfig) => void;
}

export function AddAgentModal({ onClose, config, onConfigChange }: AddAgentModalProps) {
  const addAgent = useStore(s => s.addAgent);
  // Deep links and file batches share one FIFO. The head alone seeds the form;
  // every item still requires an explicit spawn or skip.
  const hireQueue = useStore(s => s.hireQueue);
  const enqueuePendingHires = useStore(s => s.enqueuePendingHires);
  const finishPendingHire = useStore(s => s.finishPendingHire);
  const pendingHire = hireQueue.pending[0];
  const reviewProgress = hireQueueProgress(hireQueue);

  const knownCharacter = (c?: string): OfficeCharacterName =>
    (OFFICE_CAST.some(m => m.name === c) ? (c as OfficeCharacterName) : DEFAULT_CHARACTER);
  const knownAccent = (a?: string): AccentColorName =>
    (ACCENTS.includes(a as AccentColorName) ? (a as AccentColorName) : 'sky');
  /** The cast member a typed name refers to, if any.
   *
   *  The character tiles already set the name (clicking Noor names the agent
   *  Noor), but the coupling ran ONE WAY, so typing "Noor" left the
   *  avatar on whatever was selected, in practice the Theo default. Same missing
   *  default as issue #191 from the other direction, where a manifest that omits
   *  `character` always lands on Theo.
   *
   *  Returns null on no match, and the caller leaves the avatar alone, so a
   *  deliberate pick is never overwritten by continuing to type. */
  const characterForName = (n: string): OfficeCharacterName | null => {
    const q = n.trim().toLowerCase();
    if (!q) return null;
    const hit = OFFICE_CAST.find(c => c.displayName.toLowerCase() === q || c.name === q);
    return hit ? hit.name : null;
  };
  /** The locally-built spawn command for a manifest: provider preset + model
   *  from the LOCAL config builder, with the manifest's validated flags
   *  appended. A manifest can never name the binary itself. */
  const hireCommand = (m: HireManifest): string => {
    const prov: AgentProvider = m.provider ?? inferAgentProvider(config.defaultCommand);
    const base = buildSpawnCommand(config, m.model, prov);
    return m.commandFlags?.length ? `${base} ${m.commandFlags.join(' ')}` : base;
  };

  // Default provider follows whatever the global default command is (claude
  // unless the user reconfigured it); the model only carries over for Claude.
  const initialProvider = inferAgentProvider(config.defaultCommand);
  const initialModel = isClaudeProvider(initialProvider) ? config.defaultModel : undefined;

  const [name, setName] = useState(pendingHire?.name ?? 'Theo');
  const [character, setCharacter] = useState<OfficeCharacterName>(knownCharacter(pendingHire?.character));
  const [accent, setAccent] = useState<AccentColorName>(knownAccent(pendingHire?.accent));
  const [cwd, setCwd] = useState<string>(config.registeredRepos[0] ?? '');
  useEffect(() => {
    let alive = true;
    // A new folder means a new skill set — drop any explicit pick.
    setPickedSkills(null);
    if (!cwd) { setLoadout([]); return; }
    window.cth.skillsLocal(cwd)
      .then((list) => { if (alive) setLoadout(list.map((sk) => sk.name).slice(0, 12)); })
      .catch(() => { if (alive) setLoadout([]); });
    return () => { alive = false; };
  }, [cwd]);
  // Local mirror of the registered projects so one added from here shows as a
  // quick-pick immediately (the `config` prop is a snapshot taken at open time).
  const [repos, setRepos] = useState<string[]>(config.registeredRepos);
  const [provider, setProvider] = useState<AgentProvider>(pendingHire?.provider ?? initialProvider);
  const [model, setModel] = useState<string | undefined>(
    pendingHire ? pendingHire.model : initialModel
  );
  const [command, setCommand] = useState(
    pendingHire ? hireCommand(pendingHire) : buildSpawnCommand(config, initialModel, initialProvider)
  );
  const [description, setDescription] = useState(pendingHire?.description ?? 'a fresh harness');
  const [hireMeta, setHireMeta] = useState<HireManifest | null>(pendingHire);

  // Picking a model rebuilds the command; the command field stays editable for
  // power users (it's the source of truth for the actual spawn).
  const pickModel = (id?: string) => {
    setModel(id);
    setCommand(buildSpawnCommand(config, id, provider));
  };
  // Switching provider resets the model to that CLI's default and rebuilds the
  // command from the provider's preset binary (so Antigravity spawns `agy` and
  // Codex spawns `codex`, not the configured `claude`). For 'custom' we keep the
  // user's typed command rather than blanking it.
  const pickProvider = (id: AgentProvider) => {
    setProvider(id);
    // Seed the model: Claude from the global defaultModel; other engines from the
    // per-engine default set in Settings → AI Engines (providerDefaultModels), else
    // the CLI default. This is what makes that Settings field live (NIT-1).
    const nextModel = isClaudeProvider(id) ? config.defaultModel : config.providerDefaultModels?.[id];
    setModel(nextModel);
    const nextPreset = providerPreset(id);
    if (!isClaudeProvider(id) && !nextPreset.resumeFlag && !nextPreset.resumeSubcommand) {
      setResumeSessionId('');
      setFolderNote(undefined);
    }
    if (id === 'custom') {
      setCommand(command.trim() || config.defaultCommand || '');
      setCommandLocked(false);
      return;
    }
    setCommand(buildSpawnCommand(config, nextModel, id));
    setCommandLocked(true);
  };
  const preset = providerPreset(provider);
  const [goal, setGoal] = useState(pendingHire?.goal ?? '');
  const [isolate, setIsolate] = useState(pendingHire?.isolate ?? false);
  // #2 — optional Claude session id to continue. When set, the spawn seeds that
  // session's transcript into the cwd's project dir and launches `--resume`.
  const [resumeSessionId, setResumeSessionId] = useState('');
  const resuming = resumeSessionId.trim().length > 0;
  // Note shown when the folder was auto-filled from the pasted session id.
  const [folderNote, setFolderNote] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // Which config section the left sidebar index is showing.
  const [section, setSection] = useState<SectionKey>('briefing');
  // The loadout: real skills read from the chosen workspace, not invented
  // stats. Empty until a folder is picked; Rudy can hand over more later.
  const [loadout, setLoadout] = useState<string[]>([]);
  // Explicit skill pick from the Workspace step. null = "Rudy picks" (the
  // default: everything in the folder loads anyway). A list means the picked
  // names are written into the goal at spawn, so the hire reaches for them
  // first — that is what the pick actually DOES.
  const [pickedSkills, setPickedSkills] = useState<string[] | null>(null);
  // The full chip wall is opt-in: every hire gets every skill anyway, so the
  // default view is one confident line, not an alphabet of checkboxes.
  const [showSkillPick, setShowSkillPick] = useState(false);
  // Command field lock. Locked = auto-built from provider+model (the safe
  // default); custom engines start unlocked because there is nothing to build
  // from. Model/provider pickers keep rebuilding the command while locked.
  const [commandLocked, setCommandLocked] = useState(initialProvider !== 'custom');
  // "Generate a hire with AI" helper — reveals a copy-paste prompt (item 7).
  const [showHirePrompt, setShowHirePrompt] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const copyHirePrompt = async () => {
    try {
      await navigator.clipboard.writeText(HIRE_PROMPT);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 1500);
    } catch { /* clipboard blocked — the textarea below is selectable as a fallback */ }
  };

  // Close only the modal on Esc. Capture prevents the fullscreen terminal's
  // window-level handler from also closing the view underneath.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Zero-step resume: when a session id is entered, look up the cwd it originally
  // ran in (from the transcript) and pre-fill the Folder so the user doesn't have
  // to find the worktree. They can still override the folder afterwards. Runs on
  // blur so we don't hit the resolver on every keystroke.
  const resolveFolderFromSession = async () => {
    const sid = resumeSessionId.trim();
    if (!sid) { setFolderNote(undefined); return; }
    const resolved = await window.cth.resolveSessionCwd(sid);
    if (resolved) { setCwd(resolved); setFolderNote(`folder set from session: ${resolved}`); }
    else setFolderNote(undefined);
  };

  const pickFolder = async () => {
    setError(undefined);
    const res = await window.cth.chooseFolder();
    if (res.ok) setCwd(res.path);
    else if (res.error !== 'cancelled') setError(res.error);
  };

  /** Register `path` as a project (folder quick-pick) right now: dedupe-prepend,
   *  select it, persist to config, and lift the change up so it sticks. */
  const registerProject = async (path: string) => {
    const p = path.trim();
    if (!p) return;
    const next = [p, ...repos.filter((r) => r !== p)];
    setRepos(next);
    setCwd(p);
    try {
      const updated = await window.cth.updateConfig({ registeredRepos: next });
      // Main expands `~` when it persists registeredRepos, so adopt the stored
      // (absolute) list — otherwise a typed "~/dev/foo" stays literal in this
      // modal's state and rides along into the spawn.
      const stored = updated.registeredRepos ?? next;
      setRepos(stored);
      if (stored[0]) setCwd(stored[0]);
      onConfigChange?.(updated);
    } catch { /* best-effort persist */ }
  };

  /** Drop `path` from the project quick-picks.
   *
   *  Removes it from the LISTING only. The folder on disk is never touched, which
   *  is the whole point: a project you are done with should stop cluttering the
   *  picker without anything being deleted. */
  const unregisterProject = async (path: string) => {
    const next = repos.filter((r) => r !== path);
    setRepos(next);
    try {
      const updated = await window.cth.updateConfig({ registeredRepos: next });
      setRepos(updated.registeredRepos ?? next);
      onConfigChange?.(updated);
    } catch { /* best-effort persist */ }
  };

  /** Pick a brand-new folder and register it as a project in one step. */
  const addProject = async () => {
    setError(undefined);
    const res = await window.cth.chooseFolder();
    if (res.ok) await registerProject(res.path);
    else if (res.error !== 'cancelled') setError(res.error);
  };

  /** Apply an imported manifest to every form field (file import path). The
   *  command is rebuilt locally from the provider preset + validated flags — a
   *  manifest can never inject the spawn binary. Import never spawns. */
  const applyManifest = (m: HireManifest) => {
    setHireMeta(m);
    setName(m.name);
    // A manifest that names an agent but omits `character` should get the
    // matching avatar rather than the Theo default (issue #191).
    setCharacter(m.character ? knownCharacter(m.character) : (characterForName(m.name ?? '') ?? knownCharacter(undefined)));
    setAccent(knownAccent(m.accent));
    setProvider(m.provider ?? initialProvider);
    setModel(m.model);
    setCommand(hireCommand(m));
    setDescription(m.description ?? 'a fresh harness');
    setGoal(m.goal ?? '');
    setIsolate(m.isolate ?? false);
    setResumeSessionId('');
    setFolderNote(undefined);
    setSection('briefing');
  };

  // Advancing a batch keeps this modal mounted. Re-seed every form field when
  // the queue head changes so edits made while reviewing one hire cannot leak
  // into the next.
  useLayoutEffect(() => {
    if (pendingHire) applyManifest(pendingHire);
  // applyManifest intentionally closes over the config snapshot used by this
  // open modal; queue advances do not replace that snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHire]);

  const advanceHireReview = () => {
    const next = hireQueue.pending[1];
    // The pendingHire effect re-seeds every form field from the new queue head.
    finishPendingHire();
    if (!next) onClose();
  };

  const importHire = async () => {
    setError(undefined);
    const res = await window.cth.importHireFiles();
    if (res.manifests.length > 0) enqueuePendingHires(res.manifests);
    if (res.errors.length > 0) {
      const noun = res.errors.length === 1 ? 'file' : 'files';
      setError(`Skipped ${res.errors.length} invalid ${noun}: ${res.errors.join(' · ')}`);
    } else if (!res.ok && res.error && res.error !== 'cancelled') {
      setError(res.error);
    }
  };

  const skipHire = () => {
    if (!pendingHire) return;
    setError(undefined);
    advanceHireReview();
  };

  const submit = async () => {
    setError(undefined);
    // A required field can live in a section the user hasn't opened, so jump to
    // the offending section as we surface the error — the field is never hidden.
    if (!name.trim()) { setError('Name is required'); setSection('identity'); return; }
    // No project picked → the hire works out of the harness home, exactly what
    // onboarding promises ("I can work without a project on day one"). The hard
    // "Pick a folder first" stop contradicted that promise on the very first CTA.
    const spawnCwd = cwd.trim() || config.harnessHome || '';
    if (!spawnCwd) { setError('Pick a folder first'); setSection('workspace'); return; }
    if (!command.trim()) { setError('Command is required'); setSection('engine'); return; }

    setBusy(true);
    const id = uniqueId(name);
    const ptyId = `pty-${id}`;
    // Split the editable command field into argv-style pieces for node-pty.
    // Quote-aware so an agy model label like "Gemini 3.1 Pro (High)" — or any
    // auto-mode flags appended to the command — stays one argument.
    const [exe, ...args] = tokenizeCommand(command.trim());
    const spawnRes = await window.cth.spawnPty({
      id: ptyId,
      cwd: spawnCwd,
      command: exe,
      provider,
      args,
      cols: 100,
      rows: 30,
      // When set, the main process spawns this agent in its own git worktree.
      // Forced OFF when resuming a session — `--resume` needs the real cwd's
      // transcript, not a fresh worktree with a different (empty) project dir.
      isolate: resuming ? false : isolate,
      // #2 — continue an existing Claude session in this agent's cwd.
      resumeSessionId: resuming ? resumeSessionId.trim() : undefined,
      // Provision this agent in the hive (memory + mailbox + identity/protocol).
      hive: {
        id,
        name: name.trim(),
        provider,
        cwd: spawnCwd,
        role: description.trim() || undefined,
        // A hire manifest may carry validated capability tags (routing hints).
        capabilities: hireMeta?.capabilities
      }
    });
    if (!spawnRes.ok) {
      setBusy(false);
      setError(spawnRes.error ?? 'spawn failed');
      return;
    }
    // #2 — the requested resume session id wasn't found anywhere; main fell back
    // to a fresh session. Don't block the spawn, but make it visible.
    if (resuming && spawnRes.resumeNotFound) {
      console.warn(`[add-agent] resume session "${resumeSessionId.trim()}" not found, started a fresh session`);
    }

    // Main expands `~` at ingestion and echoes back the absolute path it actually
    // spawned into — record THAT, so this agent's cwd matches the hive registry
    // (and survives a restart, where nothing re-expands it).
    const spawnedCwd = spawnRes.cwd || spawnCwd;
    // With git isolation the agent RUNS in its own worktree, but its PROJECT is
    // still the folder the user picked. Labelling the agent with the worktree's
    // name was the visible half; the damaging half was promoting that worktree
    // into registeredRepos below, which turned the project quick-picks into a
    // list of throwaway worktrees. Mirrors the `isolate` sent to main, which is
    // forced off while resuming.
    const projectCwd = (!resuming && isolate) ? spawnCwd : spawnedCwd;
    // An explicit skill pick becomes part of the standing goal — that is how
    // "pick the skills" actually reaches the agent (the goal rides every prompt).
    const skillLine = pickedSkills && pickedSkills.length > 0
      ? `Lean on these workspace skills first: ${pickedSkills.join(', ')}.`
      : '';
    const finalGoal = [goal.trim(), skillLine].filter(Boolean).join('\n');
    const agent: Agent = {
      id,
      name: name.trim(),
      character,
      accent,
      description: description.trim() || 'a fresh harness',
      project: basename(projectCwd),
      tmuxTarget: '',
      cwd: spawnedCwd,
      goal: finalGoal || undefined,
      status: 'idle',
      action: resuming && spawnRes.resumeNotFound ? 'session not found, fresh start' : 'starting up',
      progress: 0,
      currentStation: 'desk',
      ptyId,
      command: command.trim(),
      provider,
      model,
      // Persist the resolved worktree path (set only when isolation provisioned
      // one) so a restart can re-enter this exact worktree — see restoreTeam.
      worktreePath: spawnRes.worktreePath,
      // Crush (seedDelivery:'type-into-tui') hands its hive protocol back here
      // instead of on argv; useHive types it into the TUI after boot. (ondev-b)
      seedPrompt: spawnRes.seedPrompt,
      recentTextTs: Date.now()
    };
    addAgent(agent);
    // Remember the folder for the next hire: promote it to the front of the
    // registeredRepos quick-picks (the modal's default cwd) so back-to-back
    // hires land in the same project without re-picking.
    if (projectCwd && repos[0] !== projectCwd) {
      const nextRepos = [projectCwd, ...repos.filter((r) => r !== projectCwd && r !== cwd)];
      try {
        const updated = await window.cth.updateConfig({ registeredRepos: nextRepos });
        onConfigChange?.(updated);
      } catch { /* best-effort */ }
    }
    // A hire manifest may carry a per-agent token budget — apply it to the
    // latest agentTokenCaps map in main. Await it before advancing a batch: the
    // next hire reuses this mounted modal and must not race a stale config write.
    if (hireMeta?.tokenCap) {
      try {
        const updated = await window.cth.setAgentTokenCap(id, hireMeta.tokenCap);
        onConfigChange?.(updated);
      } catch { /* best-effort */ }
    }
    setBusy(false);
    if (pendingHire) {
      advanceHireReview();
    } else {
      onClose();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(26, 19, 32, 0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // Must sit above fullscreen terminal/file overlays (250/280) and their
        // hover popovers. The fullscreen Add Agent button uses this same modal.
        zIndex: 500
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ width: 940, maxWidth: '95vw' }}>
        <PixelPanel
          variant="dialog"
          title="ADD AGENT"
          style={{ padding: 16 }}
          noPadding
        >
          {/* Sectioned config with a left sidebar index. The form has 11+ fields,
              so they're grouped into 4 sections (Identity / Workspace / Engine /
              Briefing) shown one at a time; the sidebar jumps between them. The
              hire-import review banner, the error, and the footer stay pinned
              around the section pane. maxHeight keeps the dialog within the
              viewport (title bar stays pinned). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, maxHeight: '86vh', overflowY: 'auto' }}>
            {hireMeta && (
              <div style={{
                padding: '6px 10px',
                background: 'var(--cth-lemon-light, #fdf3cf)',
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                fontSize: 12,
                color: 'var(--cth-ink-900)',
                display: 'flex', flexDirection: 'column', gap: 2
              }}>
                <span>
                  hire imported: <strong>{hireMeta.name}</strong>
                  {hireMeta.author ? <> · by {hireMeta.author}</> : null}
                  {reviewProgress ? <> · hire {reviewProgress.current} of {reviewProgress.total}</> : null}
                </span>
                <span>review every field, especially the command, before spawning.</span>
                {hireMeta.commandFlags && hireMeta.commandFlags.length > 0 && (
                  <span style={{ display: 'flex', gap: 4, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 2 }}>
                    <span style={{ fontSize: 12 }}>flags this hire appends to the command:</span>
                    {hireMeta.commandFlags.map((f, i) => (
                      <code
                        key={`${f}-${i}`}
                        style={{
                          fontFamily: 'var(--cth-font-mono)',
                          fontSize: 12,
                          padding: '0 4px',
                          background: 'var(--cth-paprika-light, #f6d3c4)',
                          boxShadow: 'inset 0 0 0 1px var(--cth-paprika-700, #b3502e)',
                          color: 'var(--cth-ink-900)'
                        }}
                      >
                        {f}
                      </code>
                    ))}
                  </span>
                )}
                {hireMeta.skills && hireMeta.skills.length > 0 && (
                  <span style={{ display: 'flex', gap: 4, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 2 }}>
                    <span style={{ fontSize: 12 }}>skills this hire activates:</span>
                    {hireMeta.skills.map((s) => (
                      <code
                        key={s}
                        style={{
                          fontFamily: 'var(--cth-font-mono)',
                          fontSize: 12,
                          padding: '0 4px',
                          background: 'var(--cth-mint-light, #d0f0e0)',
                          boxShadow: 'inset 0 0 0 1px var(--cth-mint-700, #1f7a4d)',
                          color: 'var(--cth-ink-900)'
                        }}
                      >
                        {s}
                      </code>
                    ))}
                  </span>
                )}
                {hireMeta.mcpServers && hireMeta.mcpServers.length > 0 && (() => {
                  const safe = hireMeta.mcpServers!.filter(
                    (id) => MCP_CATALOG.find((e) => e.id === id)?.tier === 'safe-readonly'
                  );
                  const consent = hireMeta.mcpServers!.filter(
                    (id) => MCP_CATALOG.find((e) => e.id === id)?.tier !== 'safe-readonly'
                  );
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
                      {safe.length > 0 && (
                        <span style={{ display: 'flex', gap: 4, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12 }}>MCP servers (safe, pre-enabled):</span>
                          {safe.map((id) => (
                            <code key={id} style={{
                              fontFamily: 'var(--cth-font-mono)', fontSize: 12, padding: '0 4px',
                              background: 'var(--cth-sky-light, #d0e8f8)',
                              boxShadow: 'inset 0 0 0 1px var(--cth-sky-700, #1f5a8a)',
                              color: 'var(--cth-ink-900)'
                            }}>{id}</code>
                          ))}
                        </span>
                      )}
                      {consent.length > 0 && (
                        <span style={{ display: 'flex', gap: 4, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 12 }}>MCP, needs your consent, NOT auto-enabled:</span>
                          {consent.map((id) => (
                            <code key={id} style={{
                              fontFamily: 'var(--cth-font-mono)', fontSize: 12, padding: '0 4px',
                              background: 'var(--cth-paprika-light, #f6d3c4)',
                              boxShadow: 'inset 0 0 0 1px var(--cth-paprika-700, #b3502e)',
                              color: 'var(--cth-ink-900)'
                            }}>{id}</code>
                          ))}
                          <span style={{ fontSize: 11, color: 'var(--cth-ink-700)' }}>
                            enable in Settings → MCP after reviewing
                          </span>
                        </span>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Four steps, one at a time — but the step rail runs ACROSS THE
                TOP now, so the content gets the full dialog width, and every
                step pane is the same fixed height, so the dialog never resizes
                as you move through it. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {SECTIONS.map((s, i) => {
                  const active = section === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setSection(s.key)}
                      style={{
                        flex: 1, minWidth: 0, textAlign: 'left', padding: '7px 10px 6px',
                        border: 'none', cursor: 'pointer',
                        background: active ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
                        boxShadow: active
                          ? `inset 0 0 0 1.5px var(--cth-${accent})`
                          : 'inset 0 0 0 1px var(--cth-ink-100)',
                        display: 'flex', flexDirection: 'column', gap: 2
                      }}
                    >
                      <span style={{
                        fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '13px',
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                        color: 'var(--cth-ink-900)',
                        display: 'flex', alignItems: 'baseline', gap: 6,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        <span style={{ color: active ? 'var(--cth-ink-900)' : 'var(--cth-ink-300)' }}>{i + 1}</span>
                        {s.label}
                      </span>
                      <span style={{
                        fontFamily: 'var(--cth-font-ui)', fontSize: 10, color: 'var(--cth-ink-500)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                      }}>
                        {s.hint}
                      </span>
                    </button>
                  );
                })}
              </div>
                {section === 'identity' && (
                <div style={{ height: 428, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(
                  <>
                    {/* Character select. Hiring is the one moment that earns
                        volume: dark arena, red slash, a P1 hero slot, and the
                        cast as select cards. The old PWR/SPD/FOC cells were
                        flavor with no meaning; the loadout below is the truth,
                        the skills found in the chosen workspace. */}
                    <div className="arc-arena">
                      <div className="arc-hero">
                        <span className="arc-p1">P1 · YOUR NEW HIRE</span>
                        <div className="arc-heroname">{name || '·'}</div>
                        <div className="arc-heroblurb">
                          {OFFICE_CAST.find(c => c.name === character)?.blurb ?? ''}
                        </div>
                        <div className="arc-heroport">
                          {/* 3.5 × 28px rows = 98px, inside the 100px port —
                              scale 4 was 112px and clipped the head. */}
                          <SpritePortrait character={character} scale={3.5} />
                        </div>
                        <div className="arc-loadout">
                          {/* Mirrors the Workspace step: an explicit pick shows
                              just the picked skills, otherwise everything the
                              folder ships. Every hire ALSO gets the harness
                              skill set — chips here are only the project's own.
                              The empty state is a quiet line, not a fake chip. */}
                          <span className="arc-loadout-k">
                            {pickedSkills && pickedSkills.length > 0 ? 'SKILLS · YOUR PICK' : 'SKILLS'}
                          </span>
                          {(pickedSkills ?? loadout).length > 0 ? (
                            <div className="arc-loadout-chips">
                              {(pickedSkills ?? loadout).map((sk) => <span key={sk} className="arc-skill">{sk}</span>)}
                            </div>
                          ) : (
                            <span className="arc-loadout-empty">
                              harness skills included{cwd ? '' : ' · project skills join in step 3'}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="arc-grid">
                        <div className="arc-gridhead">SELECT YOUR HIRE</div>
                        {OFFICE_CAST.map(c => (
                          <button
                            key={c.name}
                            className={`arc-card${character === c.name ? ' sel' : ''}`}
                            onClick={() => { setCharacter(c.name); setName(c.displayName); }}
                            title={c.blurb}
                          >
                            <div className="arc-card-port">
                              <SpritePortrait character={c.name} scale={1.5} />
                            </div>
                            <div className="arc-card-name">{c.displayName.toUpperCase()}</div>
                            <div className="arc-card-blurb">{c.blurb}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Name + color share one row: they are both "who is this",
                        and stacked full-width rows under the arena read as two
                        unrelated leftover fields. The color label spells out the
                        picked word (RED, GREEN) so the swatches need no legend. */}
                    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Row label="Name">
                          <input
                            value={name}
                            onChange={(e) => {
                              const next = e.target.value;
                              setName(next);
                              const match = characterForName(next);
                              if (match) setCharacter(match);
                            }}
                            placeholder="Theo"
                            style={inputStyle}
                          />
                        </Row>
                      </div>
                      <Row label={`Color · ${ACCENT_WORDS[accent]}`}>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', height: 30 }}>
                          {ACCENTS.map(a => (
                            <button
                              key={a}
                              onClick={() => setAccent(a)}
                              style={{
                                width: 26, height: 26,
                                background: `var(--cth-${a})`,
                                boxShadow: accent === a
                                  ? 'inset 0 0 0 1.5px var(--cth-ink-500), 0 0 0 2px var(--cth-ink-900)'
                                  : 'inset 0 0 0 1px var(--cth-ink-300)',
                                cursor: 'pointer',
                                border: 'none'
                              }}
                              title={ACCENT_WORDS[a]}
                              aria-label={ACCENT_WORDS[a]}
                            />
                          ))}
                        </div>
                      </Row>
                    </div>
                  </>
                )}</div>
                )}

                {section === 'workspace' && (
                <div style={{ height: 428, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(
                  <>
                    <Row label="Project">
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
                          {repos.length > 0 ? 'Pick a project, or add a new one:' : 'No projects yet, add one to get started:'}
                        </span>
                        <button
                          onClick={addProject}
                          title="Pick a folder and register it as a project"
                          style={{
                            flexShrink: 0, padding: '2px 8px 1px', border: 'none', cursor: 'pointer',
                            background: 'var(--cth-cream-200)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                            fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)',
                            display: 'inline-flex', alignItems: 'center', gap: 4
                          }}
                        >
                          <Icon name="plus" /> add project
                        </button>
                      </div>
                      {repos.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                          {repos.map((r) => (
                            /* Two buttons per chip: pick the project, or drop it
                               from this list. Nested in a span rather than one
                               button so the remove control is not a button inside
                               a button. */
                            <span
                              key={r}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'stretch',
                                background: cwd === r ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
                                boxShadow: cwd === r
                                  ? `inset 0 0 0 1.5px var(--cth-${accent})`
                                  : 'inset 0 0 0 1px var(--cth-ink-100)'
                              }}
                            >
                              <button
                                onClick={() => setCwd(r)}
                                title={r}
                                style={{
                                  padding: '3px 4px 1px 8px',
                                  background: 'transparent',
                                  fontFamily: 'var(--cth-font-ui)',
                                  fontSize: 12,
                                  cursor: 'pointer',
                                  border: 'none'
                                }}
                              >
                                {basename(r)}
                              </button>
                              <button
                                onClick={() => unregisterProject(r)}
                                title={`Remove ${basename(r)} from this list. The folder itself is left alone.`}
                                aria-label={`Remove ${basename(r)} from the project list`}
                                style={{
                                  padding: '3px 6px 1px 2px',
                                  background: 'transparent',
                                  fontFamily: 'var(--cth-font-ui)',
                                  fontSize: 12,
                                  lineHeight: 1,
                                  color: 'var(--cth-ink-500)',
                                  cursor: 'pointer',
                                  border: 'none'
                                }}
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          value={cwd}
                          onChange={(e) => setCwd(e.target.value)}
                          placeholder="/path/to/your/project"
                          style={{ ...inputStyle, flex: 1, fontFamily: 'var(--cth-font-mono)', fontSize: 12 }}
                        />
                        <PixelButton variant="secondary" size="md" onClick={pickFolder}>
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <Icon name="folder" /> pick
                          </span>
                        </PixelButton>
                      </div>
                      {cwd.trim() && !repos.includes(cwd.trim()) && (
                        <button
                          onClick={() => registerProject(cwd)}
                          title="Save this folder to your projects so it's a one-click pick next time"
                          style={{
                            alignSelf: 'flex-start', marginTop: 2,
                            padding: '2px 8px 1px', border: 'none', cursor: 'pointer',
                            background: 'var(--cth-mint-light)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                            fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)',
                            display: 'inline-flex', alignItems: 'center', gap: 4
                          }}
                        >
                          <Icon name="plus" /> save as project
                        </button>
                      )}
                    </Row>

                    {/* Skills, HERE, where the workspace is picked — the arena's
                        skills box only mirrors this. All folder skills load
                        either way; picking some writes them into the hire's
                        standing goal so it reaches for them first. */}
                    <Row label={`Skills · ${!cwd.trim() ? 'come with the project' : pickedSkills && pickedSkills.length > 0 ? `you picked ${pickedSkills.length}` : 'Rudy picks the right ones'}`}>
                      {!cwd.trim() ? (
                        <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
                          Pick a project above and the skills that live in it show up here.
                        </span>
                      ) : loadout.length === 0 ? (
                        <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
                          No skills in this folder yet. Rudy can still hand some over at the desk.
                        </span>
                      ) : !showSkillPick && !pickedSkills ? (
                        /* The highlight, not the inventory: what matters is that
                           the hire comes loaded, not the alphabetical contents. */
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 12px',
                          background: 'var(--cth-mint-light)',
                          boxShadow: 'inset 0 0 0 1px var(--cth-mint)'
                        }}>
                          <span aria-hidden style={{ width: 8, height: 8, flexShrink: 0, background: 'var(--cth-mint)' }} />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                            <span style={{
                              fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11,
                              letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)'
                            }}>comes loaded · {loadout.length} workspace skills</span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-700)' }}>
                              Every hire gets all of them automatically, on top of the built-in set. Rudy points it at the relevant ones for each job.
                            </span>
                          </div>
                          <PixelButton variant="ghost" size="sm" onClick={() => setShowSkillPick(true)}>
                            pin favorites
                          </PixelButton>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {loadout.map((sk) => {
                              const on = pickedSkills?.includes(sk) ?? false;
                              return (
                                <button
                                  key={sk}
                                  onClick={() => setPickedSkills((prev) => {
                                    const base = prev ?? [];
                                    const next = base.includes(sk) ? base.filter((x) => x !== sk) : [...base, sk];
                                    return next.length > 0 ? next : null;
                                  })}
                                  title={on ? 'Picked: this hire is briefed to reach for it first' : 'Click to brief this hire to reach for this skill first'}
                                  style={{
                                    padding: '4px 10px 3px', border: 'none', cursor: 'pointer',
                                    background: on ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
                                    boxShadow: on ? `inset 0 0 0 1.5px var(--cth-${accent})` : 'inset 0 0 0 1px var(--cth-ink-100)',
                                    fontFamily: 'var(--cth-font-mono)', fontSize: 12, color: 'var(--cth-ink-900)'
                                  }}
                                >{sk}</button>
                              );
                            })}
                            <button
                              onClick={() => { setPickedSkills(null); setShowSkillPick(false); }}
                              style={{
                                padding: '4px 10px 3px', border: 'none', cursor: 'pointer',
                                background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                                fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10,
                                letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-700)'
                              }}
                            >let Rudy pick</button>
                          </div>
                          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                            All of these load either way. Pinning some writes them into the hire's
                            standing brief so it reaches for them first.
                          </span>
                        </div>
                      )}
                    </Row>

                    <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: resuming ? 'not-allowed' : 'pointer', opacity: resuming ? 0.5 : 1 }}>
                      <input
                        type="checkbox"
                        checked={resuming ? false : isolate}
                        disabled={resuming}
                        onChange={(e) => setIsolate(e.target.checked)}
                        style={{ width: 16, height: 16, cursor: resuming ? 'not-allowed' : 'pointer' }}
                      />
                      <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)' }}>
                        Git isolation (own worktree)
                      </span>
                    </label>

                    <Row label="Resume session ID (optional)">
                      <input
                        value={resumeSessionId}
                        onChange={(e) => { setResumeSessionId(e.target.value); setFolderNote(undefined); }}
                        onBlur={resolveFolderFromSession}
                        placeholder="paste a Claude session id to continue its conversation"
                        style={{ ...inputStyle, fontFamily: 'var(--cth-font-mono)', fontSize: 12 }}
                      />
                      {folderNote && (
                        <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-mint, var(--cth-ink-700))' }}>
                          {folderNote}
                        </span>
                      )}
                      {resuming && (
                        <span style={{ fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-700)' }}>
                          Will resume this session in the chosen folder (git isolation disabled).
                        </span>
                      )}
                    </Row>
                  </>
                )}</div>
                )}

                {section === 'engine' && (
                <div style={{ height: 428, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(
                  <>
                    <Row label="Provider">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {AGENT_PROVIDER_PRESETS.map((p) => {
                          const active = provider === p.id;
                          return (
                            <button
                              key={p.id}
                              onClick={() => pickProvider(p.id)}
                              title={
                                p.id === 'antigravity'
                                  ? 'Spawn the Antigravity CLI (agy) with a Gemini model'
                                  : p.id === 'codex'
                                    ? 'Spawn the Codex CLI (codex) without Claude-only flags'
                                    : p.id === 'custom'
                                      ? 'Run any command, no Claude-only flags'
                                      : p.label
                              }
                              style={{
                                padding: '3px 8px 1px',
                                background: active ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
                                boxShadow: active
                                  ? `inset 0 0 0 1.5px var(--cth-${accent})`
                                  : 'inset 0 0 0 1px var(--cth-ink-100)',
                                fontFamily: 'var(--cth-font-ui)', fontSize: 12,
                                color: 'var(--cth-ink-900)', cursor: 'pointer', border: 'none',
                                display: 'inline-flex', alignItems: 'center', gap: 6
                              }}
                            >
                              <ProviderLogo provider={p.id} size={14} />
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </Row>

                    {preset.supportsModel && <Row label="Model">
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {(() => {
                          // An imported hire may name a model newer than this picker's
                          // hardcoded list (e.g. claude-fable-5). Surface it as a real,
                          // selected card instead of leaving the picker looking unset —
                          // the command field already carries it either way.
                          const known = modelsForProvider(provider);
                          return model && !known.some((m) => m.id === model)
                            ? [...known, { id: model, label: `${model} (from hire)` }]
                            : known;
                        })().map((m) => {
                          const active = (model ?? '') === (m.id ?? '');
                          return (
                            <button
                              key={m.label}
                              onClick={() => pickModel(m.id)}
                              title={m.id ?? 'CLI default model'}
                              style={{
                                padding: '3px 8px 1px',
                                background: active ? `var(--cth-${accent}-light)` : 'var(--cth-cream-100)',
                                boxShadow: active
                                  ? `inset 0 0 0 1.5px var(--cth-${accent})`
                                  : 'inset 0 0 0 1px var(--cth-ink-100)',
                                fontFamily: 'var(--cth-font-ui)', fontSize: 12,
                                color: 'var(--cth-ink-900)', cursor: 'pointer', border: 'none'
                              }}
                            >
                              {m.label}
                            </button>
                          );
                        })}
                      </div>
                    </Row>}

                    {/* OSS-model quick-picks (ondev-c) — local + third-party-provider
                        shortlists from the verified catalog. Clicking sets the
                        engine-correct slug (OpenCode `local/<tag>`, Crush/pi
                        `ollama/<tag>`; provider slugs are identical across engines)
                        and rebuilds the command. */}
                    {hasOssQuickPicks(provider) && (
                      <Row label="OSS models">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div>
                            <div style={ossGroupHead}>Local · no key (Ollama / LM Studio)</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {OSS_LOCAL_PICKS.map((p) => {
                                const slug = localSlugFor(provider, p.tag);
                                const active = (model ?? '') === slug;
                                return (
                                  <button
                                    key={p.tag}
                                    onClick={() => pickModel(slug)}
                                    title={`${slug} · needs ~${p.minRam} RAM: pull with: ollama pull ${p.tag}`}
                                    style={ossChip(active, accent)}
                                  >
                                    {p.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <div style={ossGroupHead}>Via OSS provider · BYOK</div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {OSS_PROVIDER_PICKS.map((p) => {
                                const active = (model ?? '') === p.slug;
                                return (
                                  <button
                                    key={p.slug}
                                    onClick={() => pickModel(p.slug)}
                                    title={`${p.slug} · set ${p.keyEnv} in Settings → AI Engines`}
                                    style={ossChip(active, accent)}
                                  >
                                    {p.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </Row>
                    )}

                    {(provider === 'opencode' || provider === 'crush' || provider === 'pi' || provider === 'qwen') && (
                      <div style={{ fontSize: 12, color: 'var(--cth-ink-500)', lineHeight: '16px', margin: '2px 0 6px' }}>
                        API keys and local endpoints for this engine live in <strong>Settings, Agents &amp; Models</strong>.
                      </div>
                    )}

                    {/* The command is BUILT from the picks above; typing in it
                        by hand is where "missed a dash, wrote Opus 5" mistakes
                        come from. So it ships locked: read-only until the user
                        explicitly unlocks it, with one click back to the safe
                        auto-built version. Custom engines start unlocked, since
                        typing the CLI is the whole point there. */}
                    <Row label={config.autoMode && preset.autoFlag ? 'Command (auto mode on)' : 'Command'}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          value={command}
                          readOnly={commandLocked}
                          onChange={(e) => setCommand(e.target.value)}
                          title={commandLocked
                            ? 'Built automatically from the provider and model above. Click edit to change it by hand.'
                            : 'Hand-edited. Click auto to rebuild it from the provider and model above.'}
                          placeholder={
                            provider === 'antigravity'
                              ? 'agy'
                              : provider === 'codex'
                                ? 'codex'
                                : provider === 'custom'
                                  ? 'your-agent-cli'
                                  : 'claude'
                          }
                          style={{
                            ...inputStyle, flex: 1, fontFamily: 'var(--cth-font-mono)',
                            background: commandLocked ? 'var(--cth-cream-100)' : 'var(--cth-paper-100)',
                            color: commandLocked ? 'var(--cth-ink-700)' : 'var(--cth-ink-900)'
                          }}
                        />
                        <PixelButton
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            if (commandLocked) { setCommandLocked(false); return; }
                            setCommand(buildSpawnCommand(config, model, provider));
                            setCommandLocked(true);
                          }}
                          title={commandLocked
                            ? 'Unlock the command for hand editing'
                            : 'Throw away hand edits and rebuild the command from the picks above'}
                        >
                          {commandLocked ? 'edit' : 'auto'}
                        </PixelButton>
                      </div>
                      {commandLocked ? (
                        <span style={{ fontSize: 12, color: 'var(--cth-ink-500)', marginTop: 4 }}>
                          Built from your engine and model picks. No typing needed.
                        </span>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--cth-ink-500)', marginTop: 4 }}>
                          Hand-edit mode. A typo here breaks the spawn, click auto to go back to the safe version.
                        </span>
                      )}
                    </Row>
                  </>
                )}</div>
                )}

                {section === 'briefing' && (
                <div style={{ height: 428, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(
                  <>
                    <Row label="The role · write your own, or start from a ready-made and rewrite it">
                      {/* Cards, not bare chips: the job title alone said nothing
                          ("Clean up the code" of WHAT?), and the goal hid in a
                          hover tooltip nobody finds. Each card now shows what
                          the agent will do; clicking fills Role + Goal below
                          and the card stays lit so you can see what you picked. */}
                      <div style={{
                        display: 'grid', gap: 6,
                        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))'
                      }}>
                        {/* The user's own role comes FIRST — the ready-mades are
                            examples, not the menu. Clicking clears both fields
                            and puts the cursor in Role. */}
                        <button
                          onClick={() => {
                            setDescription(''); setGoal('');
                            document.getElementById('cth-hire-role-input')?.focus();
                          }}
                          style={{
                            padding: '7px 10px 6px', textAlign: 'left',
                            background: 'var(--cth-paper-100)',
                            boxShadow: 'inset 0 0 0 1px var(--cth-ink-500)',
                            cursor: 'pointer', border: 'none',
                            display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0
                          }}
                        >
                          <span style={{
                            fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10.5,
                            letterSpacing: '0.05em', textTransform: 'uppercase',
                            color: 'var(--cth-ink-900)'
                          }}>Write your own</span>
                          <span style={{
                            fontSize: 11.5, lineHeight: '15px', color: 'var(--cth-ink-500)'
                          }}>any role, your words, blank slate</span>
                        </button>
                        {DESCRIPTION_TEMPLATES.map((t) => {
                          const active = description === t.description && goal === t.goal;
                          return (
                            <button
                              key={t.label}
                              onClick={() => { setDescription(t.description); setGoal(t.goal); }}
                              title={t.goal}
                              style={{
                                padding: '7px 10px 6px', textAlign: 'left',
                                background: active ? 'var(--cth-mint-light)' : 'var(--cth-cream-100)',
                                boxShadow: active
                                  ? 'inset 0 0 0 1.5px var(--cth-mint)'
                                  : 'inset 0 0 0 1px var(--cth-ink-300)',
                                cursor: 'pointer', border: 'none',
                                display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0
                              }}
                            >
                              <span style={{
                                fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10.5,
                                letterSpacing: '0.05em', textTransform: 'uppercase',
                                color: 'var(--cth-ink-900)'
                              }}>{t.label}</span>
                              <span style={{
                                fontSize: 11.5, lineHeight: '15px', color: 'var(--cth-ink-500)'
                              }}>{t.description}</span>
                            </button>
                          );
                        })}
                      </div>
                    </Row>

                    <Row label="Role">
                      <input
                        id="cth-hire-role-input"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="any job you can describe: growth hacker, data janitor, api babysitter…"
                        style={inputStyle}
                      />
                    </Row>

                    <Row label="Goal · standing orders, handed to the agent on every prompt · yours to write">
                      {/* Big enough that a prefilled goal is actually SEEN, not
                          silently tucked into a 2-line box. Roles above are
                          examples that fill this field; the field belongs to
                          the user. */}
                      <textarea
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                        placeholder={'Your words, any shape. What does this agent own, how should it work, what must it never do. Optional: leave it empty and steer the agent in chat instead. Picking a role above drops in an example you can rewrite or wipe.'}
                        rows={7}
                        style={{ ...inputStyle, fontFamily: 'var(--cth-font-ui)', resize: 'vertical', lineHeight: '17px' }}
                      />
                    </Row>
                  </>
                )}</div>
                )}
            </div>

            {error && (
              <div style={{
                padding: '6px 10px',
                background: 'var(--cth-coral-light)',
                boxShadow: 'inset 0 0 0 1px var(--cth-coral)',
                fontSize: 12,
                color: 'var(--cth-ink-900)'
              }}>
                {error}
              </div>
            )}

            {/* Ready-made hires: one slim strip, no tall doors, no dead space.
                The captions live in the tooltips. */}
            <div style={{
              padding: '8px 12px',
              background: 'var(--cth-cream-100)',
              boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
              display: 'flex', flexDirection: 'column', gap: 8
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em',
                  color: 'var(--cth-ink-500)', flex: 1, minWidth: 120
                }}>READY-MADE HIRES · SKIP THE FORM</span>
                <PixelButton variant="secondary" size="sm" onClick={importHire} disabled={busy}
                  title="Load a hire manifest (.json): it fills every field above for your review, nothing spawns by itself">
                  import .json
                </PixelButton>
                <PixelButton variant="secondary" size="sm" onClick={() => setShowHirePrompt((v) => !v)}
                  title="Copy a prompt into any chatbot, save its JSON answer, import it here">
                  {showHirePrompt ? 'hide the AI prompt' : 'generate with AI'}
                </PixelButton>
              </div>
              {/* The compaction pass moved this into hover tooltips; a first-time
                  user never hovers. One visible sentence per button, always. */}
              <span style={{ fontSize: 11.5, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                <b style={{ color: 'var(--cth-ink-700)' }}>import .json</b> loads a saved hire file and fills every field for your review.{' '}
                <b style={{ color: 'var(--cth-ink-700)' }}>generate with AI</b> gives you a prompt to paste into any chatbot (ChatGPT, Claude, whatever): describe your project, save the JSON it answers with, then import it here. Nothing spawns until you press hire.
              </span>
              {showHirePrompt && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--cth-ink-500)', lineHeight: '16px' }}>
                    Fill in your details at the bottom of the prompt before sending it.
                  </span>
                  <textarea
                    readOnly
                    value={HIRE_PROMPT}
                    onFocus={(e) => e.currentTarget.select()}
                    rows={10}
                    style={{
                      ...inputStyle,
                      width: '100%',
                      fontFamily: 'var(--cth-font-mono)', fontSize: 12, lineHeight: '16px',
                      resize: 'vertical', background: 'var(--cth-paper-100)'
                    }}
                  />
                  <div>
                    <PixelButton variant="secondary" size="sm" onClick={copyHirePrompt}>
                      {copiedPrompt ? 'copied ✓' : 'copy prompt'}
                    </PixelButton>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <div style={{ flex: 1 }} />
              {pendingHire && (
                <PixelButton variant="secondary" size="md" onClick={skipHire} disabled={busy}>skip hire</PixelButton>
              )}
              <PixelButton variant="ghost" size="md" onClick={onClose} disabled={busy}>cancel</PixelButton>
              {/* back / next walk the four steps; hire is always live. */}
              {(() => {
                const idx = SECTIONS.findIndex((s) => s.key === section);
                return (
                  <>
                    {idx > 0 && (
                      <PixelButton variant="secondary" size="md" disabled={busy}
                        onClick={() => setSection(SECTIONS[idx - 1].key)}>
                        ← back
                      </PixelButton>
                    )}
                    {idx < SECTIONS.length - 1 && (
                      // Primary and named: a grey "next →" never said WHERE it
                      // goes, so finishing a step felt like a dead end.
                      <PixelButton variant="primary" size="md" disabled={busy}
                        onClick={() => setSection(SECTIONS[idx + 1].key)}>
                        next: {SECTIONS[idx + 1].label} →
                      </PixelButton>
                    )}
                  </>
                );
              })()}
              {/* The one gold button in the app: hiring, in Rudy's own yellow. */}
              <PixelButton
                variant="primary"
                size="md"
                onClick={submit}
                disabled={busy}
                style={busy ? undefined : { background: 'var(--cth-lemon)', color: 'var(--cth-ink-900)' }}
              >
                {busy ? 'hiring…' : 'hire'}
              </PixelButton>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px 4px',
  background: 'var(--cth-paper-100)',
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 12.5,
  lineHeight: '18px',
  color: 'var(--cth-ink-900)',
  outline: 'none'
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // A <div>, deliberately NOT a <label>: the browser forwards any click
    // inside a label (its title, its whitespace) to the first control it
    // contains — with a grid of buttons in here, clicking beside the chips
    // silently "picked" the first one.
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        fontFamily: 'var(--cth-font-ui)', fontWeight: 700,
        fontSize: 10, lineHeight: '12px',
        color: 'var(--cth-ink-700)',
        textTransform: 'uppercase'
      }}>{label}</span>
      {children}
    </div>
  );
}
