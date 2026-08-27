import { useEffect, useState } from 'react';
import { PixelButton } from './PixelButton';
import { Icon, type IconName } from './Icon';
import { SpritePortrait } from './SpritePortrait';
import { ProviderLogo } from './ProviderLogo';
import { BrandLogo } from './BrandLogo';
import { OFFICE_CAST } from '@/scene/office/cast';
import { AGENT_PROVIDER_PRESETS, modelsForProvider, type AgentProvider, type HarnessConfig } from '@/store/config';
import { canReceiveInbox, providerPreset } from '@shared/agentProvider';
import {
  classifyEngineAvailability, engineAvailabilityBadge, engineAvailabilityMessage, engineBlocksOnboarding
} from '@shared/engineAvailability';
import type { ToolStatus } from '@shared/toolCatalog';

export interface OnboardingWizardProps {
  onComplete: (config: HarnessConfig) => void;
}

// The Rudy OS first run. Five screens, framed as Rudy (the clone that runs the
// floor) introducing himself and asking what he needs to clock in:
//   hello   : who you are + what the app is
//   engine  : which CLI engine and model power Rudy
//   places  : his desk (harness home) + your projects
//   rules   : autonomy, keep-awake, notifications, stats
//   review  : a summary, the crew, and the door to the office
// The layout is a split frame: a fixed dark rail on the left (logo, step list,
// Rudy himself) and the current screen on the right. Copy carries no dashes.
type Step = 'hello' | 'engine' | 'places' | 'rules' | 'review';
const STEPS: { id: Step; label: string; title: string }[] = [
  { id: 'hello',  label: 'Hello',        title: "HI, I'M RUDY." },
  { id: 'engine', label: 'Brain',        title: 'PICK MY BRAIN' },
  { id: 'places', label: 'Places',       title: 'WHERE I WORK' },
  { id: 'rules',  label: 'House rules',  title: 'HOUSE RULES' },
  { id: 'review', label: 'Clock in',     title: 'READY TO CLOCK IN' },
];
const stepIndex = (s: Step) => STEPS.findIndex((x) => x.id === s);

type Role = 'developer' | 'founder' | 'product' | 'marketing' | 'ops' | 'curious';
const ROLES: { id: Role; icon: IconName; label: string; hint: string; technical: boolean }[] = [
  { id: 'developer', icon: 'code',     label: 'Developer',         hint: 'I live in a terminal',        technical: true },
  { id: 'founder',   icon: 'sparkle',  label: 'Founder',           hint: 'I run the company',          technical: false },
  { id: 'product',   icon: 'ledger',   label: 'Product',           hint: 'I ship with a team',         technical: false },
  { id: 'marketing', icon: 'web',      label: 'Marketing or sales', hint: 'I grow the thing',           technical: false },
  { id: 'ops',       icon: 'gear',     label: 'Ops or support',    hint: 'I keep things moving',       technical: false },
  { id: 'curious',   icon: 'info',     label: 'Just curious',      hint: 'Show me what this is',       technical: false },
];

// What you get. Three tiles, each with a developer register and a plain one.
const PERKS: { icon: IconName; label: string; dev: string; plain: string; tint: string; edge: string }[] = [
  { icon: 'mcp',      label: 'TEN ENGINES, ONE FLOOR',
    dev: 'Claude Code, Codex, Gemini, Grok, Kimi, Cursor and more, side by side as live agents.',
    plain: 'Claude, Codex, Gemini, Grok, Cursor and more, working together in one office.',
    tint: 'var(--cth-lilac-light)', edge: 'var(--cth-lilac)' },
  { icon: 'web',      label: 'MEMORY THAT LASTS',
    dev: 'Every agent keeps notes, mined into one searchable memory palace.',
    plain: 'Agents remember what they did, so they never start from zero.',
    tint: 'var(--cth-mint-light)', edge: 'var(--cth-mint)' },
  { icon: 'pause',    label: 'BUDGETS AND BRAKES',
    dev: 'Per-agent token caps, a steer, constrain, stop breaker, and human approvals.',
    plain: 'Spending limits and safety stops, and agents can ask you before big moves.',
    tint: 'var(--cth-coral-light)', edge: 'var(--cth-coral)' },
];

// One line on each engine, shown on its tile so a non-technical user knows what
// they are picking. EVERY selectable engine needs one: a tile with no blurb
// leaves a hole in the grid and the row heights stop matching.
const PROVIDER_BLURB: Partial<Record<AgentProvider, string>> = {
  claude: 'By Anthropic',
  codex: 'By OpenAI',
  grok: 'By xAI',
  kimi: 'By Moonshot AI',
  gemini: 'By Google',
  antigravity: 'By Google, on Gemini',
  qwen: 'Open model, runs local',
  opencode: 'Open source, any model',
  crush: 'By Charm, open source',
  pi: 'By Parallel Web',
  copilot: 'By GitHub',
  cursor: 'Uses Cursor credits',
  custom: 'Point at any CLI you like'
};

/** The preset labels carry a vendor tail ("Codex · GPT", "Qwen (local
 *  available)") that truncates in a tile and repeats what the blurb already
 *  says. Keep the head as the name; the blurb carries the rest. */
function engineName(label: string): string {
  return label.split(/\s+[·(]/)[0].trim();
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>('hello');
  const [role, setRole] = useState<Role | undefined>();
  // The stored audience is still a binary; the role picks the default and the
  // checkbox lets anyone flip it.
  const [technical, setTechnical] = useState<boolean>(false);
  const plain = !technical;

  const [home, setHome] = useState<string>('');
  const [repos, setRepos] = useState<string[]>([]);
  const [autoMode, setAutoMode] = useState<boolean>(true);
  // Anonymous usage stats (TELEMETRY.md). Default ON (opt-out); persisted by
  // finish() so unchecking before finishing means nothing is ever sent.
  const [shareStats, setShareStats] = useState<boolean>(true);
  const [bossProvider, setBossProvider] = useState<AgentProvider>('claude');
  const [bossModel, setBossModel] = useState<string | undefined>(
    providerPreset('claude').recommendedOrchestratorModel
  );
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  // Which engine CLIs are actually on this machine. `undefined` = probe not
  // back yet (or failed): tiles show no badge and nothing is blocked, because a
  // broken probe must not lock a new user out.
  const [engines, setEngines] = useState<ToolStatus[] | undefined>();
  const [probing, setProbing] = useState(false);
  const probeEngines = async () => {
    setProbing(true);
    try { setEngines(await window.cth.toolsStatus()); }
    catch { /* leave undefined: unknown, never blocking */ }
    finally { setProbing(false); }
  };
  useEffect(() => { void probeEngines(); }, []);
  const selectedEngine = classifyEngineAvailability(engines, bossProvider);
  const engineBlocked = engineBlocksOnboarding(selectedEngine);

  // Reliability toggles apply IMMEDIATELY on change (their own IPC / OS state);
  // they are NOT part of finish()'s config write.
  const [strongKeepalive, setStrongKeepalive] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [openAtLogin, setOpenAtLogin] = useState(false);

  const toggleStrongKeepalive = async (v: boolean) => {
    setStrongKeepalive(v);
    try { setStrongKeepalive((await window.cth.updateConfig({ strongKeepalive: v })).strongKeepalive === true); }
    catch { setStrongKeepalive(!v); }
  };
  const toggleNotifications = async (v: boolean) => {
    setNotifications(v);
    try { await window.cth.setNotifications(v); }
    catch { setNotifications(!v); }
  };
  const toggleOpenAtLogin = async (v: boolean) => {
    setOpenAtLogin(v);
    try { setOpenAtLogin(await window.cth.setLoginItem(v)); }
    catch { setOpenAtLogin(!v); }
  };

  // Suggest `~/myHarness`; it is expanded at the config-write boundary and
  // at ensureHarnessHome's mkdir (see normalizeHiveHome / expandTilde).
  useEffect(() => {
    if (!home) setHome('~/myHarness');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickHome = async () => {
    setError(undefined);
    const res = await window.cth.chooseFolder();
    if (res.ok) setHome(res.path);
    else if (res.error !== 'cancelled') setError(res.error);
  };
  const pickRepo = async () => {
    setError(undefined);
    const res = await window.cth.chooseFolder();
    if (res.ok && !repos.includes(res.path)) setRepos([...repos, res.path]);
    else if (!res.ok && res.error !== 'cancelled') setError(res.error);
  };
  const removeRepo = (path: string) => setRepos(repos.filter(r => r !== path));

  const go = (s: Step) => { setError(undefined); setStep(s); };
  const next = () => {
    if (step === 'hello' && !role) { setError('Pick the one that sounds most like you.'); return; }
    if (step === 'engine' && engineBlocked) {
      setError(`${providerPreset(bossProvider).label} is not installed. Install it and press "check again", or pick another engine.`);
      return;
    }
    if (step === 'places' && !home.trim()) { setError("I need a desk. Pick or type a folder first."); return; }
    const i = stepIndex(step);
    go(STEPS[Math.min(i + 1, STEPS.length - 1)].id);
  };
  const back = () => { const i = stepIndex(step); go(STEPS[Math.max(i - 1, 0)].id); };

  const finish = async () => {
    setBusy(true);
    setError(undefined);
    const harnessHome = home.trim();
    if (!harnessHome) { setError("I need a desk. Pick or type a folder first."); setBusy(false); setStep('places'); return; }
    // A late probe result can change the answer after the user moved on. Never
    // write a bossProvider that is known to be unable to boot.
    if (engineBlocked) {
      setError(`${providerPreset(bossProvider).label} is not installed. Install it and press "check again", or pick another engine.`);
      setBusy(false); setStep('engine'); return;
    }
    const ensure = await window.cth.ensureHarnessHome(harnessHome);
    if (!ensure.ok) {
      setError(ensure.error ?? 'could not create the home folder');
      setBusy(false);
      return;
    }
    const nextCfg = await window.cth.updateConfig({
      onboardingComplete: true,
      audience: technical ? 'technical' : 'non-technical',
      role,
      harnessHome,
      registeredRepos: repos,
      autoMode,
      bossProvider,
      bossModel,
      telemetryEnabled: shareStats
    });
    setBusy(false);
    onComplete(nextCfg);
  };

  const current = STEPS[stepIndex(step)];
  const modelLabel = modelsForProvider(bossProvider).find((m) => (m.id ?? '') === (bossModel ?? ''))?.label ?? 'CLI default';

  return (
    <div className="cth-onb-overlay">
      {/* A dark band under the macOS traffic lights (the window is
          titleBarStyle: hiddenInset, so they sit over this overlay). Without it
          they wash out against the light ground. */}
      <div className="cth-onb-topband cth-titlebar-drag" aria-hidden="true" />
      <div className="cth-onb-frame">
        {/* ── rail ─────────────────────────────────────────────────────── */}
        <aside className="cth-onb-rail">
          <div className="cth-onb-rail-top">
            <BrandLogo height={22} tone="onDark" />
            <div className="cth-onb-rail-kicker">FIRST RUN · {stepIndex(step) + 1} OF {STEPS.length}</div>
          </div>
          <ol className="cth-onb-steps">
            {STEPS.map((s, i) => {
              const state = s.id === step ? 'current' : i < stepIndex(step) ? 'done' : 'todo';
              return (
                <li key={s.id} className={`cth-onb-step is-${state}`}>
                  <span className="cth-onb-step-num">{state === 'done' ? '✓' : String(i + 1)}</span>
                  <span className="cth-onb-step-label">{s.label}</span>
                </li>
              );
            })}
          </ol>
          <div className="cth-onb-rail-rudy">
            <div className="cth-onb-rudy-frame"><SpritePortrait character="rudy" scale={3} /></div>
            <div>
              <div className="cth-onb-rudy-name">RUDY</div>
              <div className="cth-onb-rudy-role">The original. I run the floor, you run me.</div>
            </div>
          </div>
        </aside>

        {/* ── screen ───────────────────────────────────────────────────── */}
        <section className="cth-onb-main">
          <header className="cth-onb-head">
            <div className="cth-onb-eyebrow">{step === 'hello' ? 'WELCOME TO RUDY OS' : `STEP ${stepIndex(step) + 1}`}</div>
            <h2 className="cth-onb-title">{current.title}</h2>
          </header>

          <div className="cth-onb-body">
            {step === 'hello' && (
              <>
                <p className="cth-onb-lede">
                  I run your office. Rudy OS turns the CLI coding agent you
                  already use into a team that keeps working when you step away: agents with
                  memory, tasks, triggers and a floor to walk on.
                  <span className="cth-onb-muted"> Everything runs on this machine.</span>
                </p>

                <div className="cth-onb-label">WHAT YOU GET</div>
                <div className="cth-onb-perks">
                  {PERKS.map((p) => (
                    <div key={p.label} className="cth-onb-perk" style={{ background: p.tint, boxShadow: `inset 0 0 0 2px ${p.edge}` }}>
                      <span className="cth-onb-icon"><Icon name={p.icon} /></span>
                      <div>
                        <div className="cth-onb-perk-label">{p.label}</div>
                        <div className="cth-onb-perk-desc">{plain ? p.plain : p.dev}</div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="cth-onb-label">AND WHO ARE YOU? (I'll talk your language)</div>
                <div className="cth-onb-roles">
                  {ROLES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`cth-onb-role${role === r.id ? ' is-on' : ''}`}
                      onClick={() => { setRole(r.id); setTechnical(r.technical); setError(undefined); }}
                    >
                      <span className="cth-onb-icon"><Icon name={r.icon} /></span>
                      <span className="cth-onb-role-label">{r.label}</span>
                      <span className="cth-onb-role-hint">{r.hint}</span>
                    </button>
                  ))}
                </div>
                <label className="cth-onb-check">
                  <input type="checkbox" checked={technical} onChange={(e) => setTechnical(e.target.checked)} />
                  <span>I'm comfortable with terminals and model names. Show me flags and ids, not just plain language.</span>
                </label>
              </>
            )}

            {step === 'engine' && (
              <>
                <p className="cth-onb-lede">
                  {plain
                    ? <>I run on a <strong>CLI coding agent</strong>, an AI assistant that lives on your computer. Pick the one I think with. <strong>Claude Code</strong> is the recommended start, and you can add the others to the team later.</>
                    : <>Pick the engine and model I run on. I orchestrate the floor, so give me a long-context, high-capability model. <strong>Claude Code</strong> is the recommended start; every other agent can run its own engine later.</>}
                </p>
                <div className="cth-onb-engines">
                  {AGENT_PROVIDER_PRESETS.filter((p) => canReceiveInbox(p.id)).map((p) => {
                    const sel = bossProvider === p.id;
                    const a = classifyEngineAvailability(engines, p.id);
                    const badge = engineAvailabilityBadge(a);
                    const bad = a.state === 'not-installable';
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`cth-onb-engine${sel ? ' is-on' : ''}${bad ? ' is-off' : ''}${p.id === 'claude' ? ' is-rec' : ''}`}
                        title={a.path ?? (badge ? `${engineName(p.label)}: ${badge.toLowerCase()}` : undefined)}
                        onClick={() => { setBossProvider(p.id); setBossModel(p.recommendedOrchestratorModel); setError(undefined); }}
                      >
                        <span className="cth-onb-engine-logo"><ProviderLogo provider={p.id} size={16} /></span>
                        <span className="cth-onb-engine-name">{engineName(p.label)}</span>
                        <span className={`cth-onb-radio${sel ? ' is-on' : ''}`} aria-hidden="true" />
                        <span className="cth-onb-engine-blurb">{PROVIDER_BLURB[p.id] ?? 'CLI coding agent'}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="cth-onb-modelrow">
                  <div className="cth-onb-label" style={{ margin: 0 }}>MODEL</div>
                  <select className="cth-onb-select" value={bossModel ?? ''} onChange={(e) => setBossModel(e.target.value || undefined)}>
                    {modelsForProvider(bossProvider).map((m) => (
                      <option key={m.label} value={m.id ?? ''}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* One reserved slot, always the same height. Picking an engine
                    that is not on this machine swaps the quiet note for the
                    warning IN PLACE, so nothing below it ever jumps. */}
                <div className={`cth-onb-status${engineBlocked ? ' is-warn' : ''}`}>
                  <span className={`cth-onb-dot ${dotClass(selectedEngine.state)}`} aria-hidden="true" />
                  <span className="cth-onb-status-text">
                    {engineBlocked
                      ? engineAvailabilityMessage(selectedEngine, providerPreset(bossProvider).label)
                      : selectedEngine.state === 'installed'
                        ? <>{providerPreset(bossProvider).label} is installed on this Mac, so I can start on it right away. This sets my engine only; every other agent can run its own.</>
                        : selectedEngine.state === 'installs-on-first-run'
                          ? <>{providerPreset(bossProvider).label} is not on this Mac yet. I install it the first time I start, nothing for you to do. This sets my engine only.</>
                          : <>This sets my engine only. Every other agent on the floor can run its own, and you can change mine later in Settings.</>}
                  </span>
                  {engineBlocked && (
                    <span className="cth-onb-status-acts">
                      <PixelButton variant="secondary" size="sm" onClick={() => { void probeEngines(); }} disabled={probing}>
                        {probing ? 'checking...' : 'check again'}
                      </PixelButton>
                      {selectedEngine.docsUrl && (
                        <PixelButton variant="ghost" size="sm" onClick={() => { void window.cth.openExternal(selectedEngine.docsUrl!); }}>
                          how to install
                        </PixelButton>
                      )}
                    </span>
                  )}
                </div>
              </>
            )}

            {step === 'places' && (
              <>
                <div className="cth-onb-place">
                  <div className="cth-onb-place-head">
                    <span className="cth-onb-icon"><Icon name="folder" /></span>
                    <div>
                      <div className="cth-onb-label" style={{ margin: 0 }}>MY DESK</div>
                      <div className="cth-onb-hint">
                        {plain
                          ? 'One folder I call home. My settings, the team\'s memory and their notes live here, so nothing is lost when you restart. You will not need to open it day to day.'
                          : 'My harness home. Agent metadata, logs and memory are pinned here so sessions resume after a restart, and any repo you create from inside the app lands here too.'}
                      </div>
                    </div>
                  </div>
                  <div className="cth-onb-row">
                    <input value={home} onChange={(e) => setHome(e.target.value)} placeholder="~/myHarness" style={inputStyle} />
                    <PixelButton variant="secondary" size="md" onClick={pickHome}>
                      <Icon name="folder" /> pick a folder
                    </PixelButton>
                  </div>
                  <div className="cth-onb-hint">
                    Keep <code className="cth-onb-code">~/myHarness</code> and I create it for you. To use another spot, type a path or pick a folder; the picker has a "New Folder" button if it does not exist yet.
                  </div>
                </div>

                <div className="cth-onb-place">
                  <div className="cth-onb-place-head">
                    <span className="cth-onb-icon"><Icon name="code" /></span>
                    <div>
                      <div className="cth-onb-label" style={{ margin: 0 }}>YOUR PROJECTS</div>
                      <div className="cth-onb-hint">
                        {plain
                          ? 'A project is simply a folder: code, documents, notes, anything you want the team to work on. Optional now, add more any time.'
                          : 'The repos my agents work in. Each folder becomes a project (a room on the floor) and several agents can share one. Optional now, add more later.'}
                      </div>
                    </div>
                  </div>
                  <div className="cth-onb-repos">
                    {repos.length === 0 && <div className="cth-onb-empty">Nothing added yet. I can work without a project on day one.</div>}
                    {repos.map((r) => (
                      <div key={r} className="cth-onb-repo">
                        <Icon name="folder" />
                        <span className="cth-onb-repo-path">{r}</span>
                        <PixelButton variant="ghost" size="sm" onClick={() => removeRepo(r)}><Icon name="x" /></PixelButton>
                      </div>
                    ))}
                  </div>
                  <div>
                    <PixelButton variant="secondary" size="md" onClick={pickRepo}>
                      <Icon name="plus" /> {plain ? 'add a project' : 'add a repo'}
                    </PixelButton>
                  </div>
                </div>
              </>
            )}

            {step === 'rules' && (
              <>
                <div className="cth-onb-label">HOW MUCH CAN MY TEAM DO ON ITS OWN?</div>
                <div className="cth-onb-options">
                  <button type="button" className={`cth-onb-option${autoMode ? ' is-on' : ''}`} onClick={() => setAutoMode(true)}>
                    <span className="cth-onb-option-head">
                      <span className="cth-onb-icon"><Icon name="play" /></span>
                      <span className="cth-onb-option-title">LET THEM RUN</span>
                    </span>
                    <span className="cth-onb-option-desc">
                      {plain
                        ? 'They carry out tasks without stopping to ask. Best when agents work in their own projects.'
                        : 'Auto mode: Claude runs bypassPermissions, Codex skips approvals and the sandbox. A foot gun on production repos.'}
                    </span>
                  </button>
                  <button type="button" className={`cth-onb-option${!autoMode ? ' is-on' : ''}`} onClick={() => setAutoMode(false)}>
                    <span className="cth-onb-option-head">
                      <span className="cth-onb-icon"><Icon name="pause" /></span>
                      <span className="cth-onb-option-title">ASK ME FIRST</span>
                    </span>
                    <span className="cth-onb-option-desc">
                      {plain
                        ? 'They pause and ask before changing files or running commands. Slower, you see every step.'
                        : 'Each engine keeps its ask-first default: Claude prompts on edits and shell.'}
                    </span>
                  </button>
                </div>
                <div className="cth-onb-hint">You can change this later, for the whole floor or for one agent.</div>

                <div className="cth-onb-label">WHILE YOU ARE AWAY</div>
                <div className="cth-onb-toggles">
                  <ToggleRow icon="clock" label="KEEP THIS MAC AWAKE" on={strongKeepalive} onChange={toggleStrongKeepalive}
                    desc="So my schedules and terminals fire on time while you are away. Held only while someone is working, and it costs battery, so it is best on power." />
                  <ToggleRow icon="bell" label="TELL YOU WHEN SOMETHING NEEDS YOU" on={notifications} onChange={toggleNotifications}
                    desc="A desktop notification when an agent is stuck or waiting on your answer. macOS asks permission the first time." />
                  <ToggleRow icon="play" label="START ME AT LOGIN" on={openAtLogin} onChange={toggleOpenAtLogin}
                    desc="Open Rudy OS after a reboot so scheduled work picks up without you." />
                </div>

                <div className="cth-onb-label">PRIVACY</div>
                <div className="cth-onb-toggles">
                  <ToggleRow icon="info" label="SHARE ANONYMOUS USAGE STATS" on={shareStats} onChange={() => setShareStats(!shareStats)}
                    desc="Anonymous events only: app opened, agent spawned, setup finished. Never your prompts, your code or anything an agent writes." />
                </div>
              </>
            )}

            {step === 'review' && (
              <>
                <p className="cth-onb-lede">
                  Here is the setup. Change anything, then open the office and I clock in.
                </p>
                <div className="cth-onb-summary">
                  <SummaryRow label="Brain" value={`${providerPreset(bossProvider).label} · ${modelLabel}`} onChange={() => go('engine')} />
                  <SummaryRow label="Desk" value={home.trim() || 'not set'} mono onChange={() => go('places')} />
                  <SummaryRow label="Projects" value={repos.length === 0 ? 'none yet' : repos.length === 1 ? repos[0] : `${repos.length} folders`} mono={repos.length === 1} onChange={() => go('places')} />
                  <SummaryRow label="Agents" value={autoMode ? 'run on their own' : 'ask before acting'} onChange={() => go('rules')} />
                  <SummaryRow label="Stats" value={shareStats ? 'anonymous usage stats on' : 'off'} onChange={() => go('rules')} />
                  <SummaryRow label="You" value={`${ROLES.find((r) => r.id === role)?.label ?? 'someone'}, ${technical ? 'shown flags and model ids' : 'shown plain language'}`} onChange={() => go('hello')} />
                </div>

                <div className="cth-onb-label">YOUR CREW</div>
                <div className="cth-onb-crew">
                  {OFFICE_CAST.map((c) => (
                    <div key={c.name} className="cth-onb-crew-member" title={c.blurb}>
                      <div className="cth-onb-crew-art"><SpritePortrait character={c.name} scale={2} /></div>
                      <div className="cth-onb-crew-name">{c.displayName}</div>
                    </div>
                  ))}
                </div>
                <div className="cth-onb-hint">
                  Fifteen of me, one per job. Name an agent after one and it gets that look; the job is just a hint, any of them can do anything.
                </div>
              </>
            )}
          </div>

          {error && <div className="cth-onb-error">{error}</div>}

          <footer className="cth-onb-foot">
            <div className="cth-onb-foot-left">
              {step !== 'hello' && (
                <PixelButton variant="ghost" size="md" onClick={back} disabled={busy}>back</PixelButton>
              )}
            </div>
            <div className="cth-onb-foot-right">
              {step !== 'review' ? (
                <PixelButton variant="primary" size="md" onClick={next} disabled={(step === 'hello' && !role) || (step === 'engine' && engineBlocked)}>
                  {step === 'hello' ? "let's go" : 'next'}
                </PixelButton>
              ) : (
                <PixelButton variant="primary" size="md" onClick={finish} disabled={busy}>
                  {busy ? 'opening...' : 'open the office'}
                </PixelButton>
              )}
            </div>
          </footer>
        </section>
      </div>
    </div>
  );
}

/** Availability is one dot on the status strip, coloured by what happens if you
 *  keep this engine: green it is here, amber Rudy installs it, grey you have to. */
function dotClass(state: string): string {
  if (state === 'installed') return 'is-ok';
  if (state === 'installs-on-first-run') return 'is-soon';
  if (state === 'not-installable') return 'is-bad';
  return 'is-quiet';
}

function ToggleRow({ icon, label, desc, on, onChange }: {
  icon: IconName; label: string; desc: string; on: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <label className={`cth-onb-toggle${on ? ' is-on' : ''}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="cth-onb-icon"><Icon name={icon} /></span>
      <span style={{ minWidth: 0 }}>
        <span className="cth-onb-perk-label">{label}</span>
        <span className="cth-onb-hint" style={{ display: 'block' }}>{desc}</span>
      </span>
    </label>
  );
}

function SummaryRow({ label, value, mono, onChange }: { label: string; value: string; mono?: boolean; onChange: () => void }) {
  return (
    <div className="cth-onb-sumrow">
      <span className="cth-onb-sumlabel">{label}</span>
      <span className={`cth-onb-sumvalue${mono ? ' is-mono' : ''}`}>{value}</span>
      <button type="button" className="cth-onb-link" onClick={onChange}>change</button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '7px 9px 6px',
  background: 'var(--cth-paper-100)',
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
  fontFamily: 'var(--cth-font-mono)',
  fontSize: 13,
  color: 'var(--cth-ink-900)',
  outline: 'none'
};
