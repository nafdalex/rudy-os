import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import { AGENT_MODELS, type HarnessConfig } from '@/store/config';
import { useStore } from '@/store/store';
import {
  CLONE_NODE_BLURB,
  DEFAULT_TRIGGER_MODE,
  DEFAULT_WEBHOOK_SCHEMA,
  TRIGGER_MODES,
  type OrgTriggerConfig,
  type TriggerMode,
  type WebhookTrigger
} from '@shared/triggers';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { PixelToggle } from './PixelToggle';
import { UpdatesSection } from './UpdatesSection';
import { SettingsHeroCard } from './SettingsHeroCard';
import { SetupPanel } from './SetupPanel';
import { Icon } from './Icon';
import { McpDefaultsSettings } from './McpDefaultsSettings';
import { IntegrationsRegistry } from './IntegrationsRegistry';
import { AiEnginesSettings } from './AiEnginesSettings';

export interface SettingsModalProps {
  config: HarnessConfig;
  onClose: () => void;
  /** Open straight to a section instead of General. Used by deep links from
   *  elsewhere in the UI — "set it now" beside a disabled Talk button lands on
   *  the tab that actually holds the field, rather than making the user hunt. */
  initialSection?: Section;
}

/**
 * The triggers IPC surface. `src/preload/index.ts` is owned by another lane and
 * these methods are landing there in parallel, so `CthApi` doesn't declare them
 * yet — read them off a narrow local view instead of widening the preload
 * contract from the renderer. Every call site wraps them in try/catch, which also
 * covers the window in which a method is still missing at runtime.
 */
interface TriggersApi {
  listWebhooks: () => Promise<WebhookTrigger[]>;
  saveWebhooks: (list: WebhookTrigger[]) => Promise<{ ok: boolean; error?: string }>;
  deleteWebhook: (id: string) => Promise<{ ok: boolean; error?: string }>;
  generateWebhookSecret: () => Promise<{ ok: boolean; secret?: string }>;
  webhooksStatus: () => Promise<{ running: boolean; url?: string }>;
  getOrgTrigger: () => Promise<OrgTriggerConfig>;
  setOrgTrigger: (cfg: OrgTriggerConfig) => Promise<{ ok: boolean; error?: string }>;
}
const triggersApi = (): TriggersApi => window.cth as unknown as TriggersApi;

/** Process-unique id for a new webhook — it is the path segment callers POST to,
 *  so it must be stable and collision-free across renames. */
function newWebhookId(): string {
  return `wh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}


/* ── Connections cards ────────────────────────────────────────────────────
   Each connection is one collapsible card with its state in the header, so
   the section reads as a list of services instead of a 500-line wall. */
function StatusDot({ on, onText, offText }: { on: boolean; onText: string; offText: string }) {
  return (
    <span style={{
      flexShrink: 0, fontSize: 11, fontFamily: 'var(--cth-font-mono)',
      color: on ? 'var(--cth-mint)' : 'var(--cth-ink-500)'
    }}>
      {on ? '● ' : '○ '}{on ? onText : offText}
    </span>
  );
}

function ConnCard({ title, blurb, status, defaultOpen = false, children }: {
  title: string;
  blurb: string;
  status?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: 'var(--cth-paper-100)', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
          padding: '9px 12px', border: 'none', cursor: 'pointer',
          background: 'var(--cth-cream-100)', boxShadow: open ? 'inset 0 -1px 0 var(--cth-ink-100)' : 'none'
        }}
      >
        <span style={{ flexShrink: 0, width: 10, fontSize: 11, color: 'var(--cth-ink-500)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block', fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10.5,
            letterSpacing: '0.1em', color: 'var(--cth-ink-900)'
          }}>{title}</span>
          <span style={{ display: 'block', fontSize: 11.5, lineHeight: '15px', color: 'var(--cth-ink-500)', marginTop: 1 }}>
            {blurb}
          </span>
        </span>
        {status}
      </button>
      {open && (
        <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Pixel-aesthetic text input, mirroring AddAgentModal's inputStyle. */
const slackInputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px 4px',
  background: 'var(--cth-paper-100)',
  border: 'none',
  boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
  fontFamily: 'var(--cth-font-ui)',
  fontSize: 12.5,
  color: 'var(--cth-ink-900)',
  outline: 'none'
};

const slackLabelStyle: CSSProperties = {
  fontFamily: 'var(--cth-font-ui)', fontWeight: 700,
  fontSize: 10,
  lineHeight: '12px',
  color: 'var(--cth-ink-700)',
  textTransform: 'uppercase'
};

/** The exact connect walkthrough shown behind the i icon. Steps 6 & 7 spell out
 *  the both-lists requirement: subscribe to message.channels / message.groups in
 *  BOTH "Subscribe to bot events" AND "Subscribe to events on behalf of users". */
const SLACK_CONNECT_STEPS = `Connect Rudy OS to Slack

1. api.slack.com/apps -> Create New App -> From scratch. Name it
   "Rudy OS" and pick your workspace.
2. Basic Information -> Signing Secret -> copy it into the
   "Signing secret" field here.
3. OAuth & Permissions -> Bot Token Scopes: add
     chat:write          (office replies in-thread)
     channels:history    (read public-channel messages)
     groups:history      (read private-channel messages)
   Install to workspace, then copy the Bot User OAuth Token
   (xoxb-...) into the "Bot token" field here.
4. Press Start (below) to launch the webhook and get your
   Request URL.
5. Event Subscriptions -> Enable Events -> Request URL: paste the
   Request URL from here and wait for Slack's green check (Verified).
6. Event Subscriptions -> "Subscribe to bot events": add
     message.channels
     message.groups
7. Event Subscriptions -> "Subscribe to events on behalf of users"
   (add the matching User Token Scope channels:history / groups:history
   first if Slack asks): add
     message.channels
     message.groups
8. Save Changes, reinstall if Slack prompts, then invite the bot
   to your channel:  /invite @RudyOS`;

/** The request/response contract shown behind the webhook i icon. Every webhook
 *  shares one server and one tunnel and is told apart by its id in the path, so
 *  `<tunnel>` is the public base URL and `<webhookId>` picks the endpoint. The
 *  secret/token go in headers so they stay out of URLs and access logs. */
/** Photon connect walkthrough. Deliberately short: unlike Slack there is no
 *  app to create, no scopes to tick and no Request URL to paste back, because
 *  the connection dials out from this machine. */
const PHOTON_CONNECT_STEPS = `Connect Rudy OS to iMessage

1. photon.codes -> sign in -> create a project.
2. Copy the Project ID and Project Secret from the
   project's dashboard and paste them here.
3. Add the phone number or email of everyone allowed to
   text this office. iMessage carries no signature Rudy
   can verify, so this list is the only thing standing
   between a stranger's text and your agents. Anyone not
   on it is ignored silently.
4. Press connect. There is no URL to paste back and
   nothing to re-do after a restart.

Texting it:
- Send a normal message. Rudy replies "Queued: ..." and
  waits for your tapback: thumbs-up runs it, thumbs-down
  drops it.
- Approving in Settings -> Triggers does exactly the same
  thing, if you would rather use the screen.
- A thumbs-up on YOUR message is Rudy saying "got it".`;

const WEBHOOK_API_DOC = `Webhook API

Every webhook has its own URL, its own secret and its own mode. They share one
server and one tunnel; the id in the path says which one you are calling.

Trigger work (POST <tunnel>/<webhookId>):
  header  x-md-webhook-secret: <that webhook's secret>
  body    {"message": "do X for me", "title": "optional short title",
           "kind": "directive" | "communication", "from": "who is calling"}
  -> 200  {"ok": true, "token": "<capability token>", "taskId": "<card id>"}
  -> 202  {"ok": true, "status": "awaiting approval"}

Check status (GET <tunnel>/<webhookId>):
  header  x-md-webhook-token: <token>     (or  ?token=<token>)
  -> 200  {"ok": true, "status": "todo|doing|blocked|done",
           "title": "...", "result": "<summary or null>"}

The mode decides which of the two answers you get:
  allow all           routes straight through -> 200
  communication only  chatter routes; a directive gets 202 awaiting approval
  strict              everything gets 202 awaiting approval

A 202 means the message is parked in Trigger History until you approve it; the
token you were handed still reads that task once it is routed. The secret
authorizes new work, the token only reads one task's status. Keep both private.

Each webhook checks bodies against its own JSON schema, edit that in the
Triggers tab of Rudy's Command Center.`;

/** Clear every renderer-side persisted key so a relaunch starts truly empty. */
function clearLocalState(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith('cth.')) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch { /* noop */ }
}

// v0.3.4 redesign: six tabs, one topic each. 'AI Engines' folded into
// Agents & Models; MCP + Slack + webhook + REST live together in Connections;
// voice gets its own tab; Danger Zone became a red row at the bottom of General.
export type Section = 'General' | 'Prerequisites' | 'Agents & Models' | 'Autonomy & Budgets' | 'Connections' | 'Memory & Knowledge';
// The rail reads as Rudy's own map of the app, not a flat list: four rooms,
// each holding the sections that belong together.
const NAV_GROUPS: Array<{ label: string; items: Section[] }> = [
  { label: 'OFFICE', items: ['General', 'Prerequisites'] },
  { label: 'CREW', items: ['Agents & Models', 'Autonomy & Budgets'] },
  { label: 'WIRES', items: ['Connections'] },
  { label: 'MIND', items: ['Memory & Knowledge'] }
];

export function SettingsModal({ config, onClose, initialSection }: SettingsModalProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>(initialSection ?? 'General');

  // Change-home flow: null until the user picks a new folder, then the sub-modal
  // confirms move-vs-fresh. Pre-selects 'move' (recommended - keeps the data).
  const [changeHome, setChangeHome] = useState<string | null>(null);
  const [changeMode, setChangeMode] = useState<'move' | 'fresh'>('move');
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeErr, setChangeErr] = useState('');

  // `notifications` is an optional field on the main-process config; the renderer
  // mirror type may not declare it yet, so read it defensively.
  const [notifications, setNotifications] = useState<boolean>(
    (config as HarnessConfig & { notifications?: boolean }).notifications === true
  );

  const toggleNotifications = async () => {
    const next = !notifications;
    setNotifications(next); // optimistic
    try { await window.cth.setNotifications(next); }
    catch { setNotifications(!next); /* revert on failure */ }
  };

  // ─── v0.3.4 redesign: settings that were onboarding-trapped or UI-less ────
  const cfgX = config as HarnessConfig & {
    strongKeepalive?: boolean; audience?: string; autoMode?: boolean;
    defaultModel?: string; maxTurns?: number; semanticMemory?: boolean;
  };
  const [keepAwake, setKeepAwake] = useState<boolean>(cfgX.strongKeepalive === true);
  const toggleKeepAwake = async () => {
    const next = !keepAwake;
    setKeepAwake(next);
    try { await window.cth.updateConfig({ strongKeepalive: next } as Partial<HarnessConfig>); }
    catch { setKeepAwake(!next); }
  };
  const [simpleMode, setSimpleMode] = useState<boolean>(cfgX.audience === 'non-technical');
  const toggleSimpleMode = async () => {
    const next = !simpleMode;
    setSimpleMode(next);
    try { await window.cth.updateConfig({ audience: next ? 'non-technical' : 'technical' } as Partial<HarnessConfig>); }
    catch { setSimpleMode(!next); }
  };
  const [autoModeOn, setAutoModeOn] = useState<boolean>(cfgX.autoMode !== false);
  const toggleAutoMode = async () => {
    const next = !autoModeOn;
    setAutoModeOn(next);
    try { await window.cth.updateConfig({ autoMode: next } as Partial<HarnessConfig>); }
    catch { setAutoModeOn(!next); }
  };
  // Default OFF, so an absent value must read as off. Note this is `=== true`,
  // the mirror image of autoMode's `!== false` above, because the two defaults
  // are opposite.
  const [orchSpawnOn, setOrchSpawnOn] = useState<boolean>(cfgX.orchestratorMaySpawn === true);
  const toggleOrchSpawn = async () => {
    const next = !orchSpawnOn;
    setOrchSpawnOn(next);
    try { await window.cth.updateConfig({ orchestratorMaySpawn: next } as Partial<HarnessConfig>); }
    catch { setOrchSpawnOn(!next); }
  };
  const [defaultModelSel, setDefaultModelSel] = useState<string>(cfgX.defaultModel ?? 'claude-fable-5');
  const [defaultModelNote, setDefaultModelNote] = useState('');
  const saveDefaultModel = async (id: string) => {
    setDefaultModelSel(id);
    try {
      await window.cth.updateConfig({ defaultModel: id } as Partial<HarnessConfig>);
      setDefaultModelNote('saved, applies to newly spawned agents');
      setTimeout(() => setDefaultModelNote(''), 2200);
    } catch { setDefaultModelNote('save failed'); }
  };
  const [maxTurnsVal, setMaxTurnsVal] = useState<string>(cfgX.maxTurns != null ? String(cfgX.maxTurns) : '');
  const saveMaxTurns = async () => {
    const n = maxTurnsVal.trim() === '' ? undefined : Number(maxTurnsVal);
    await window.cth.updateConfig({ maxTurns: Number.isFinite(n as number) && (n as number) > 0 ? Math.round(n as number) : undefined } as Partial<HarnessConfig>);
  };
  const [semMemOn, setSemMemOn] = useState<boolean>(cfgX.semanticMemory !== false);
  const toggleSemMem = async () => {
    const next = !semMemOn;
    setSemMemOn(next);
    try { await window.cth.updateConfig({ semanticMemory: next } as Partial<HarnessConfig>); }
    catch { setSemMemOn(!next); }
  };

  // --- circuit-breaker config (Lane A #6 canonical fields, widened view) ---
  // Drives the real breaker: floor-wide TOKEN budget (costCapTokens) + output-
  // token velocity ceiling (circuitBreaker.tokenVelocityPerMin). The token cap
  // replaced the old dollar cap as the user-facing budget.
  type BreakerCfgView = HarnessConfig & {
    costCapTokens?: number;
    circuitBreaker?: { tokenVelocityPerMin?: number; enabled?: boolean; hardStop?: boolean; repeatedToolLimit?: number; errorStormLimit?: number };
  };
  const breakerCfg = config as BreakerCfgView;
  const [agentBudget, setAgentBudget] = useState(breakerCfg.costCapTokens != null ? String(breakerCfg.costCapTokens) : '');
  const [velocityCeiling, setVelocityCeiling] = useState(breakerCfg.circuitBreaker?.tokenVelocityPerMin != null ? String(breakerCfg.circuitBreaker.tokenVelocityPerMin) : '');
  const [budgetNote, setBudgetNote] = useState('');
  // v0.3.4: the four previously UI-less breaker fields get controls.
  const [brkEnabled, setBrkEnabled] = useState<boolean>(breakerCfg.circuitBreaker?.enabled !== false);
  const [brkHardStop, setBrkHardStop] = useState<boolean>(breakerCfg.circuitBreaker?.hardStop === true);
  const [brkRepeated, setBrkRepeated] = useState(breakerCfg.circuitBreaker?.repeatedToolLimit != null ? String(breakerCfg.circuitBreaker.repeatedToolLimit) : '');
  const [brkErrStorm, setBrkErrStorm] = useState(breakerCfg.circuitBreaker?.errorStormLimit != null ? String(breakerCfg.circuitBreaker.errorStormLimit) : '');
  const saveBudget = async () => {
    const tokens = agentBudget.trim() === '' ? undefined : Number(agentBudget);
    const vel = velocityCeiling.trim() === '' ? undefined : Number(velocityCeiling);
    const rep = brkRepeated.trim() === '' ? undefined : Number(brkRepeated);
    const storm = brkErrStorm.trim() === '' ? undefined : Number(brkErrStorm);
    await window.cth.updateConfig({
      costCapTokens: Number.isFinite(tokens as number) ? (tokens as number) : undefined,
      circuitBreaker: {
        ...(breakerCfg.circuitBreaker ?? {}),
        enabled: brkEnabled,
        hardStop: brkHardStop,
        tokenVelocityPerMin: Number.isFinite(vel as number) ? (vel as number) : undefined,
        repeatedToolLimit: Number.isFinite(rep as number) ? Math.round(rep as number) : undefined,
        errorStormLimit: Number.isFinite(storm as number) ? Math.round(storm as number) : undefined
      }
    } as Partial<HarnessConfig>);
    setBudgetNote('saved');
    setTimeout(() => setBudgetNote(''), 1500);
  };
  const fmtBudgetTokens = (raw: string): string => {
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n) || n <= 0) return '';
    if (n >= 1e9) return `${+(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
    return String(n);
  };

  // --- Slack integration ---
  const [slackEnabled, setSlackEnabled] = useState(config.slackEnabled ?? false);
  const [slackSecret, setSlackSecret] = useState(config.slackSigningSecret ?? '');
  const [slackBotToken, setSlackBotToken] = useState(config.slackBotToken ?? '');
  const [slackChannel, setSlackChannel] = useState(config.slackChannelId ?? '');
  const [slackPort, setSlackPort] = useState(String(config.slackPort ?? 3847));
  // App/voice-initiated proactive posting (the "queued" ack). Default OFF —
  // the Slack-origin done-reply round-trip is unaffected by this toggle.
  const [slackProactivePosting, setSlackProactivePosting] = useState(config.slackProactivePosting ?? false);
  const [tunnelUrl, setTunnelUrl] = useState('');
  const [slackBusy, setSlackBusy] = useState(false);
  const [slackNote, setSlackNote] = useState('');
  // Whether the webhook server is currently live. Hydrated from main on open so
  // reopening Settings shows the true connection state + the persisted Request URL.
  const [running, setRunning] = useState(false);
  // Whether the connect-steps help panel is expanded.
  const [showSlackHelp, setShowSlackHelp] = useState(false);

  // --- iMessage via Photon ---
  const [photonEnabled, setPhotonEnabled] = useState(config.photonEnabled ?? false);
  const [photonProjectId, setPhotonProjectId] = useState(config.photonProjectId ?? '');
  // Write-only: never hydrated from main, only ever sent. Blank means "keep the
  // saved one", matching how the integrations registry treats a stored key.
  const [photonSecret, setPhotonSecret] = useState('');
  const [photonHasSecret, setPhotonHasSecret] = useState(false);
  const [photonAllowlist, setPhotonAllowlist] = useState((config.photonAllowlist ?? []).join(', '));
  const [photonRunning, setPhotonRunning] = useState(false);
  const [photonBusy, setPhotonBusy] = useState(false);
  const [photonNote, setPhotonNote] = useState('');
  const [showPhotonHelp, setShowPhotonHelp] = useState(false);

  // --- Webhook triggers (a LIST; src/shared/triggers.ts owns the type) ---------
  // The list itself lives in the store, not in local state: the Triggers tab
  // edits the same webhooks, and one of the two surfaces holding a private copy
  // is exactly the drift this feature exists to prevent.
  const webhookTriggers = useStore((s) => s.webhookTriggers);
  const setWebhookTriggersStore = useStore((s) => s.setWebhookTriggers);
  /** Public base URL of the shared tunnel; each webhook's endpoint is `<base>/<id>`. */
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookRunning, setWebhookRunning] = useState(false);
  const [webhookBusy, setWebhookBusy] = useState(false);
  const [webhookNote, setWebhookNote] = useState('');
  /** Which secrets the user has unmasked, by webhook id. Reset on every reopen. */
  const [shownSecrets, setShownSecrets] = useState<Record<string, boolean>>({});
  /** Webhook awaiting a second delete click — deleting one revokes a live caller. */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [showWebhookHelp, setShowWebhookHelp] = useState(false);

  // --- Organisation trigger (peer messaging; configuration only for now) ------
  const orgTrigger = useStore((s) => s.orgTrigger);
  const setOrgTriggerStore = useStore((s) => s.setOrgTrigger);
  const [showOrgKey, setShowOrgKey] = useState(false);
  const [orgBusy, setOrgBusy] = useState(false);
  const [orgNote, setOrgNote] = useState('');

  // ─── Knowledge Graph (enterprise multimodal context for agents) ───────────
  const [kgEnabled, setKgEnabled] = useState<boolean>(
    (config as HarnessConfig & { knowledgeGraph?: { enabled?: boolean } }).knowledgeGraph?.enabled === true
  );
  const [kgDocCount, setKgDocCount] = useState(0);
  const [kgBusy, setKgBusy] = useState(false);
  const [kgNote, setKgNote] = useState('');

  const refreshKgStatus = async () => {
    try { const s = await window.cth.kgStatus(); setKgDocCount(s.docCount); }
    catch { /* status unavailable */ }
  };

  const toggleKg = async () => {
    const next = !kgEnabled;
    setKgEnabled(next);
    try {
      await window.cth.updateConfig({ knowledgeGraph: { enabled: next } });
      if (next) await refreshKgStatus();
    } catch { setKgEnabled(!next); }
  };

  const addKgFiles = async () => {
    setKgBusy(true); setKgNote('');
    try {
      const res = await window.cth.kgAddFiles();
      if (!res.ok) { setKgNote(res.error === 'cancelled' ? '' : (res.error ?? 'failed')); return; }
      const added = res.results.filter((r) => r.ok).length;
      const failed = res.results.length - added;
      setKgNote(`added ${added} document${added === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}`);
      await refreshKgStatus();
    } catch (e) { setKgNote(e instanceof Error ? e.message : String(e)); }
    finally { setKgBusy(false); }
  };

  // ─── Scheduled auto-compact — the compact-maintenance mission's enabled flag.
  // The mission itself stays the single source of truth (the Triggers tab edits
  // the same field); this is just a General-section shortcut. Default OFF (v0.3.4).
  const [autoCompactOn, setAutoCompactOn] = useState<boolean>(
    (config.missions ?? []).some((m) => m.id === 'compact-maintenance' && m.enabled)
  );
  const toggleAutoCompact = async () => {
    const next = !autoCompactOn;
    setAutoCompactOn(next);
    try {
      const cfg = await window.cth.getConfig();
      const missions = (cfg.missions ?? []).map((m) =>
        m.id === 'compact-maintenance' ? { ...m, enabled: next } : m
      );
      await window.cth.updateConfig({ missions });
    } catch { setAutoCompactOn(!next); }
  };

  // ─── Auto-update (default ON; gates main's updater checks entirely) ────────
  const [autoUpdateOn, setAutoUpdateOn] = useState<boolean>(config.autoUpdate !== false);
  const toggleAutoUpdate = async () => {
    const next = !autoUpdateOn;
    setAutoUpdateOn(next);
    try { await window.cth.updateConfig({ autoUpdate: next }); }
    catch { setAutoUpdateOn(!next); }
  };

  // ─── Anonymous usage stats (default ON = opt-out; contract in TELEMETRY.md) ─
  const [telemetryOn, setTelemetryOn] = useState<boolean>(config.telemetryEnabled !== false);
  const toggleTelemetry = async () => {
    const next = !telemetryOn;
    setTelemetryOn(next);
    try { await window.cth.updateConfig({ telemetryEnabled: next }); }
    catch { setTelemetryOn(!next); }
  };


  // Re-seed every editable field from the on-disk config when the modal opens.
  // App's `config` prop is loaded once and never refreshed after a save, so
  // without this the saved budget / velocity / slack values show blank on reopen.
  useEffect(() => {
    let alive = true;
    window.cth.getConfig().then((c) => {
      if (!alive) return;
      const cc = c as BreakerCfgView;
      setNotifications(cc.notifications === true);
      setAgentBudget(cc.costCapTokens != null ? String(cc.costCapTokens) : '');
      setVelocityCeiling(cc.circuitBreaker?.tokenVelocityPerMin != null ? String(cc.circuitBreaker.tokenVelocityPerMin) : '');
      setSlackEnabled(cc.slackEnabled ?? false);
      setSlackSecret(cc.slackSigningSecret ?? '');
      setSlackBotToken(cc.slackBotToken ?? '');
      setSlackChannel(cc.slackChannelId ?? '');
      setSlackPort(String(cc.slackPort ?? 3847));
      setSlackProactivePosting(cc.slackProactivePosting ?? false);
      setPhotonEnabled(cc.photonEnabled ?? false);
      setPhotonProjectId(cc.photonProjectId ?? '');
      setPhotonAllowlist((cc.photonAllowlist ?? []).join(', '));
      const kgOn = (cc as { knowledgeGraph?: { enabled?: boolean } }).knowledgeGraph?.enabled === true;
      setKgEnabled(kgOn);
    }).catch(() => { /* keep prop-seeded values */ });
    window.cth.kgStatus().then((s) => { if (alive) setKgDocCount(s.docCount); })
      .catch(() => { /* status unavailable */ });
    // Hydrate live connection state + the persisted Request URL: the
    // tunnel URL lives in main, so reopening Settings while connected re-shows it.
    window.cth.photonStatus().then((st) => {
      if (!alive) return;
      setPhotonRunning(st.running);
      setPhotonHasSecret(st.hasSecret);
    }).catch(() => { /* status unavailable - assume not running */ });
    window.cth.slackStatus().then((s) => {
      if (!alive) return;
      setRunning(s.running);
      if (s.url) setTunnelUrl(s.url);
    }).catch(() => { /* status unavailable - assume not running */ });
    // Triggers: re-read main and push the result into the shared mirror. App
    // already seeded it at launch; this catches anything the Triggers tab (or
    // another window) changed since, and is the ONLY place Settings reads them —
    // every render below comes off the store.
    void (async () => {
      try {
        const list = await triggersApi().listWebhooks();
        if (alive && Array.isArray(list)) useStore.getState().setWebhookTriggers(list);
      } catch { /* keep the mirror App seeded from getConfig() */ }
      try {
        const org = await triggersApi().getOrgTrigger();
        if (alive && org) useStore.getState().setOrgTrigger(org);
      } catch { /* ditto */ }
      try {
        const s = await triggersApi().webhooksStatus();
        if (!alive) return;
        setWebhookRunning(s.running);
        if (s.url) setWebhookUrl(s.url);
      } catch { /* status unavailable - assume not listening */ }
    })();
    return () => { alive = false; };
  }, []);

  /** Persist the current Slack inputs. Returns the resolved config patch. */
  const slackPatch = (enabled: boolean) => ({
    signingSecret: slackSecret,
    botToken: slackBotToken,
    channelId: slackChannel,
    port: Number(slackPort) || 3847,
    enabled,
    proactivePosting: slackProactivePosting
  });

  const saveSlack = async () => {
    setSlackBusy(true); setSlackNote('');
    try {
      await window.cth.slackSetConfig(slackPatch(slackEnabled));
      setSlackNote('saved');
    } catch (e) {
      setSlackNote(e instanceof Error ? e.message : String(e));
    } finally { setSlackBusy(false); }
  };

  const startSlack = async () => {
    setSlackBusy(true); setSlackNote('');
    try {
      // Persist first so the server starts with the latest secret/port/channel.
      await window.cth.slackSetConfig(slackPatch(true));
      setSlackEnabled(true);
      const res = await window.cth.slackStart();
      if (res.ok) {
        setRunning(true);
        // Keep the last URL if this start returned none (tunnel hiccup) - don't blank it.
        if (res.url) setTunnelUrl(res.url);
        setSlackNote(res.url ? 'listening' : (res.error ?? 'started, but tunnel unavailable'));
      } else {
        setSlackNote(res.error ?? 'failed to start');
      }
    } catch (e) {
      setSlackNote(e instanceof Error ? e.message : String(e));
    } finally { setSlackBusy(false); }
  };

  const stopSlack = async () => {
    setSlackBusy(true); setSlackNote('');
    // Keep the last Request URL visible (greyed) after Stop.
    try { await window.cth.slackStop(); setRunning(false); setSlackNote('stopped'); }
    catch (e) { setSlackNote(e instanceof Error ? e.message : String(e)); }
    finally { setSlackBusy(false); }
  };

  /** Handles are comma/newline separated in the box; main re-trims anyway. */
  const photonHandles = (): string[] =>
    photonAllowlist.split(/[,\n]/).map((h) => h.trim()).filter(Boolean);

  const savePhotonSecretIfProvided = async (): Promise<string | null> => {
    if (!photonSecret.trim()) return null;                // blank = keep existing
    const r = await window.cth.photonSetSecret(photonSecret.trim());
    if (!r.ok) return r.error ?? 'could not store the secret';
    setPhotonSecret('');                                   // never keep it in renderer state
    setPhotonHasSecret(true);
    return null;
  };

  const savePhoton = async () => {
    setPhotonBusy(true); setPhotonNote('');
    try {
      const err = await savePhotonSecretIfProvided();
      if (err) { setPhotonNote(err); return; }
      await window.cth.photonSetConfig({
        projectId: photonProjectId, allowlist: photonHandles(), enabled: photonEnabled
      });
      setPhotonNote('saved');
    } catch (e) {
      setPhotonNote(e instanceof Error ? e.message : String(e));
    } finally { setPhotonBusy(false); }
  };

  const startPhoton = async () => {
    setPhotonBusy(true); setPhotonNote('');
    try {
      const err = await savePhotonSecretIfProvided();
      if (err) { setPhotonNote(err); return; }
      // Persist first so the channel opens with the latest id/allowlist.
      await window.cth.photonSetConfig({
        projectId: photonProjectId, allowlist: photonHandles(), enabled: true
      });
      setPhotonEnabled(true);
      const res = await window.cth.photonStart();
      if (res.ok) { setPhotonRunning(true); setPhotonNote('connected'); }
      else { setPhotonNote(res.error ?? 'failed to connect'); }
    } catch (e) {
      setPhotonNote(e instanceof Error ? e.message : String(e));
    } finally { setPhotonBusy(false); }
  };

  const stopPhoton = async () => {
    setPhotonBusy(true); setPhotonNote('');
    try { await window.cth.photonStop(); setPhotonRunning(false); setPhotonNote('disconnected'); }
    catch (e) { setPhotonNote(e instanceof Error ? e.message : String(e)); }
    finally { setPhotonBusy(false); }
  };

  // --- Webhook trigger handlers ---
  /** The one write path. Updates the shared mirror FIRST so the Triggers tab
   *  repaints immediately, then persists. Pass `persist: false` for keystroke
   *  edits (a rename) — the blur commits them. */
  const applyWebhooks = async (list: WebhookTrigger[], persist = true) => {
    setWebhookTriggersStore(list);
    if (!persist) return;
    setWebhookBusy(true); setWebhookNote('');
    try {
      const res = await triggersApi().saveWebhooks(list);
      if (res && res.ok === false) { setWebhookNote(res.error ?? 'could not save'); return; }
      setWebhookNote('saved');
      setTimeout(() => setWebhookNote(''), 1500);
    } catch (e) {
      setWebhookNote(e instanceof Error ? e.message : String(e));
    } finally { setWebhookBusy(false); }
  };

  /** Replace one entry by id (the shape every per-row control uses). */
  const patchWebhook = (id: string, patch: Partial<WebhookTrigger>, persist = true) =>
    applyWebhooks(webhookTriggers.map((w) => (w.id === id ? { ...w, ...patch } : w)), persist);

  /** New endpoint: main mints the secret (256-bit), and it ships DISABLED —
   *  turning on a public surface is always an explicit second click. */
  const addWebhook = async () => {
    setWebhookBusy(true); setWebhookNote('');
    let secret = '';
    try {
      const res = await triggersApi().generateWebhookSecret();
      secret = res.ok && res.secret ? res.secret : '';
    } catch (e) {
      setWebhookNote(e instanceof Error ? e.message : String(e));
    } finally { setWebhookBusy(false); }
    if (!secret) { setWebhookNote('could not generate a secret'); return; }
    const entry: WebhookTrigger = {
      id: newWebhookId(),
      name: `Webhook ${webhookTriggers.length + 1}`,
      secret,
      enabled: false,
      mode: DEFAULT_TRIGGER_MODE,
      schema: DEFAULT_WEBHOOK_SCHEMA,
      createdAt: Date.now()
    };
    setShownSecrets((s) => ({ ...s, [entry.id]: true })); // show it once, to copy
    await applyWebhooks([...webhookTriggers, entry]);
  };

  /** Mint a fresh secret for ONE endpoint. The old one stops working at once —
   *  that is the point, and it never disturbs the other webhooks. */
  const rotateWebhookSecret = async (id: string) => {
    setWebhookBusy(true); setWebhookNote('');
    let secret = '';
    try {
      const res = await triggersApi().generateWebhookSecret();
      secret = res.ok && res.secret ? res.secret : '';
    } catch (e) {
      setWebhookNote(e instanceof Error ? e.message : String(e));
    } finally { setWebhookBusy(false); }
    if (!secret) { setWebhookNote('could not generate a secret'); return; }
    setShownSecrets((s) => ({ ...s, [id]: true }));
    await patchWebhook(id, { secret });
    setWebhookNote('new secret, copy it now');
  };

  const removeWebhook = async (id: string) => {
    setPendingDelete(null);
    setWebhookBusy(true); setWebhookNote('');
    try {
      await triggersApi().deleteWebhook(id);
      setWebhookNote('deleted');
      setTimeout(() => setWebhookNote(''), 1500);
    } catch (e) {
      setWebhookNote(e instanceof Error ? e.message : String(e));
    } finally { setWebhookBusy(false); }
    // Mirror the removal either way: if main rejected it, the next open re-reads.
    setWebhookTriggersStore(webhookTriggers.filter((w) => w.id !== id));
  };

  /** Endpoint URL for one webhook: every entry shares the tunnel, the id picks it. */
  const webhookEndpoint = (id: string) => (webhookUrl ? `${webhookUrl.replace(/\/$/, '')}/${id}` : '');
  const copyTunnel = () => { void window.cth.copyToClipboard(tunnelUrl); };

  // --- Organisation trigger handlers ---
  /** Same contract as webhooks: mirror first (so the Triggers tab is live), then
   *  persist. Keystroke edits pass `persist: false` and commit on blur. */
  const applyOrg = async (next: OrgTriggerConfig, persist = true) => {
    setOrgTriggerStore(next);
    if (!persist) return;
    setOrgBusy(true); setOrgNote('');
    try {
      const res = await triggersApi().setOrgTrigger(next);
      if (res && res.ok === false) { setOrgNote(res.error ?? 'could not save'); return; }
      setOrgNote('saved');
      setTimeout(() => setOrgNote(''), 1500);
    } catch (e) {
      setOrgNote(e instanceof Error ? e.message : String(e));
    } finally { setOrgBusy(false); }
  };

  const reset = async () => {
    setBusy(true);
    clearLocalState();
    // Wipes hive + palace, resets config, and relaunches into onboarding.
    // The app exits, so this never resolves - no need to clear `busy`.
    await window.cth.resetAll();
  };

  // --- Change home folder ---
  /** Pick a new folder, then open the move-vs-fresh sub-modal. */
  const pickNewHome = async () => {
    setChangeErr('');
    const res = await window.cth.chooseFolder();
    if (!res.ok) return; // cancelled - no-op
    setChangeMode('move'); // recommended default
    setChangeHome(res.path);
  };

  /** Apply the home-folder change. On success the app relaunches (never resolves);
   *  on failure we surface the error and the existing home keeps running. */
  const applyChangeHome = async () => {
    if (!changeHome) return;
    setChangeBusy(true); setChangeErr('');
    // Moving copies the hive (incl. its .git) + palace, so the new home owns the
    // same renderer-side roster - keep localStorage. A 'fresh' home starts empty,
    // so clear the renderer cache to match.
    if (changeMode === 'fresh') clearLocalState();
    try {
      const res = await window.cth.changeHome(changeHome, changeMode);
      if (!res.ok) { setChangeErr(res.error ?? 'Could not change the home folder.'); setChangeBusy(false); }
      // ok === true never returns (the process relaunches).
    } catch (e) {
      setChangeErr(e instanceof Error ? e.message : String(e));
      setChangeBusy(false);
    }
  };

  const modalTitle = changeHome
    ? 'CHANGE HOME FOLDER'
    : confirming
      ? 'RESET EVERYTHING?'
      : 'SETTINGS';

  return (
    <div
      onClick={busy ? undefined : onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(26, 19, 32, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 300
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 840, maxWidth: '92vw', maxHeight: '88vh',
          display: 'flex', flexDirection: 'column',
          filter: 'drop-shadow(4px 4px 0 rgba(26, 19, 32, 0.25))'
        }}
      >
        <PixelPanel
          variant="dialog"
          title={modalTitle}
          noPadding
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', maxHeight: '88vh' }}
        >
          {/* === Change home sub-modal === */}
          {changeHome ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>New home folder</span>
                <code style={{
                  fontFamily: 'var(--cth-font-mono, monospace)', fontSize: 12,
                  color: 'var(--cth-ink-900)', wordBreak: 'break-all'
                }}>{changeHome}</code>
              </div>

              {/* Move vs. fresh - two selectable option rows; move is preselected. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {([
                  ['move', 'Move existing data (recommended)', "Copy this harness's hive (every agent, memory, task) and the semantic-memory palace into the new folder. The old folder is left untouched as a backup you can delete later."],
                  ['fresh', 'Start fresh', 'Point the harness at the new (empty) folder. Your existing data stays in the old folder, simply unused.']
                ] as const).map(([value, title, desc]) => {
                  const selected = changeMode === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setChangeMode(value)}
                      disabled={changeBusy}
                      style={{
                        textAlign: 'left', cursor: changeBusy ? 'default' : 'pointer',
                        padding: '10px 12px', background: 'var(--cth-paper-100)', border: 'none',
                        boxShadow: `inset 0 0 0 ${selected ? 2 : 1}px ${selected ? 'var(--cth-ink-900)' : 'var(--cth-ink-300)'}`,
                        display: 'flex', flexDirection: 'column', gap: 3
                      }}
                    >
                      <span style={{
                        fontSize: 13, lineHeight: '20px',
                        color: 'var(--cth-ink-900)', fontWeight: selected ? 700 : 400
                      }}>
                        {selected ? '◉ ' : '○ '}{title}
                      </span>
                      <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>{desc}</span>
                    </button>
                  );
                })}
              </div>

              {changeErr && (
                <div style={{ fontSize: 12, lineHeight: '18px', color: '#6E1423' }}>{changeErr}</div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <PixelButton variant="secondary" size="md" onClick={() => { setChangeHome(null); setChangeErr(''); }} disabled={changeBusy}>
                  cancel
                </PixelButton>
                <PixelButton variant="primary" size="md" onClick={applyChangeHome} disabled={changeBusy}>
                  {changeBusy ? 'applying...' : (changeMode === 'move' ? 'move & restart' : 'switch & restart')}
                </PixelButton>
              </div>
            </div>

          /* === Reset confirmation screen === */
          ) : confirming ? (
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  width: 32, height: 32,
                  background: 'var(--cth-coral-light)',
                  boxShadow: 'inset 0 0 0 1.5px var(--cth-ink-500)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <Icon name="bell" />
                </div>
                <div style={{ flex: 1, fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-700)' }}>
                  This permanently erases all of Rudy's memories and the entire hive,
                  and cannot be undone. Any running sessions will be terminated and the app
                  will relaunch into onboarding. Are you sure?
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <PixelButton variant="secondary" size="md" onClick={() => setConfirming(false)} disabled={busy}>
                  cancel
                </PixelButton>
                <PixelButton variant="destructive" size="md" onClick={reset} disabled={busy}>
                  {busy ? 'resetting...' : 'erase everything & restart'}
                </PixelButton>
              </div>
            </div>

          /* === Main two-pane settings layout === */
          ) : (
            <>
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

                {/* Left nav: four labelled rooms. The active section sits on a
                    caramel tile (the same ground every face in the app stands on)
                    with a red pixel marker, so the rail carries the house identity
                    instead of a generic list-with-a-line. Ink literals on the tile
                    are deliberate: caramel is theme-constant, so its text must be too. */}
                <div style={{
                  width: 172, flexShrink: 0,
                  display: 'flex', flexDirection: 'column', gap: 14,
                  padding: '14px 10px',
                  borderRight: '1px dashed var(--cth-ink-100)',
                  background: 'var(--cth-cream-100)',
                  overflowY: 'auto'
                }}>
                  {NAV_GROUPS.map((group) => (
                    <div key={group.label} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{
                        fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 9,
                        letterSpacing: '0.14em', color: 'var(--cth-ink-300)',
                        padding: '0 8px 3px'
                      }}>
                        {group.label}
                      </span>
                      {group.items.map((section) => {
                        const active = activeSection === section;
                        return (
                          <button
                            key={section}
                            type="button"
                            onClick={() => setActiveSection(section)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 7,
                              width: '100%', textAlign: 'left',
                              padding: '7px 8px',
                              border: 'none', borderRadius: 4,
                              background: active ? '#F2ECE4' : 'transparent',
                              boxShadow: active ? 'inset 0 0 0 1px rgba(38, 34, 46, 0.18)' : 'none',
                              color: active ? '#26222E' : 'var(--cth-ink-500)',
                              fontFamily: 'var(--cth-font-ui)', fontWeight: 700,
                              fontSize: 10.5,
                              lineHeight: '13px',
                              cursor: 'pointer',
                              letterSpacing: '0.02em'
                            }}
                          >
                            <span style={{
                              width: 6, height: 6, borderRadius: 1, flexShrink: 0,
                              background: active ? '#B3121B' : 'var(--cth-ink-100)'
                            }} />
                            {section}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Right scrollable content pane. minWidth:0 lets this flex child
                    shrink to the row's width instead of growing to its content's
                    min-content (which would push a horizontal scrollbar). */}
                <div style={{
                  flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden',
                  padding: '20px 24px',
                  display: 'flex', flexDirection: 'column', gap: 20
                }}>

                  {/* GENERAL */}
                  {activeSection === 'General' && (
                    <>
                      {/* Who you are and what this install is — version, plan,
                          sponsor, and the app-level actions that belong to none
                          of the settings below. Slots for a future subscription
                          and a sponsor live here; both render nothing until set. */}
                      <SettingsHeroCard />

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />

                      {/* Updates — first among the settings proper, because "am I
                          on the latest?" is the question people open Settings to
                          answer, and the toolbar chip says nothing at all when
                          the answer is yes. */}
                      <UpdatesSection />

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />

                      {/* Home folder */}
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Home folder
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 13, lineHeight: '20px', alignItems: 'center' }}>
                          <span style={{
                            flex: 1, color: 'var(--cth-ink-900)', wordBreak: 'break-all',
                            fontFamily: 'var(--cth-font-mono, monospace)'
                          }}>{config.harnessHome ?? ''}</span>
                          <PixelButton variant="secondary" size="sm" onClick={pickNewHome}>change...</PixelButton>
                        </div>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />

                      {/* Environment — settings that used to be trapped in onboarding */}
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Environment
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>Keep Mac awake while agents run</span>
                              <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                                Blocks display sleep so schedules and terminals keep firing on time. Costs battery, best on AC.
                              </span>
                            </div>
                            <PixelToggle on={keepAwake} onClick={toggleKeepAwake} />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>Explain things simply</span>
                              <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                                Agents brief you in plain language instead of engineering shorthand.
                              </span>
                            </div>
                            <PixelToggle on={simpleMode} onClick={toggleSimpleMode} />
                          </div>
                        </div>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />

                      {/* Desktop notifications toggle */}
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Notifications
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                              Desktop notifications
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Native toasts when an agent finishes or needs your input.
                            </span>
                          </div>
                          <PixelToggle on={notifications} onClick={toggleNotifications} />
                        </div>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />

                      {/* Scheduled auto-compact (compact-maintenance mission) */}
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Maintenance
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                              Scheduled auto-compact
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Queue /compact for every agent on a schedule (hourly by default; interval
                              in the Triggers tab). Off by default, long-running agents may overflow
                              their context without it.
                            </span>
                          </div>
                          <PixelToggle on={autoCompactOn} onClick={toggleAutoCompact} />
                        </div>
                        <div style={{ height: 10 }} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                              Auto-update
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Check GitHub releases and download updates in the background;
                              you choose when to restart. Never restarts on its own.
                            </span>
                          </div>
                          <PixelToggle on={autoUpdateOn} onClick={toggleAutoUpdate} />
                        </div>
                        <div style={{ height: 10 }} />
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                              Anonymous usage stats
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              A handful of anonymous events (app opened, agent spawned, feature used), 
                              never prompts, code, paths, or agent output. Full list in TELEMETRY.md.
                            </span>
                          </div>
                          <PixelToggle on={telemetryOn} onClick={toggleTelemetry} />
                        </div>
                      </div>

                    </>
                  )}

                  {/* AGENTS & MODELS — what powers the office */}
                  {/* PREREQUISITES — the external tools the app leans on and
                      whether this machine has them. It was a Command Center tab,
                      which was the wrong home: it is machine-wide state, not
                      something about the agent whose terminal you are reading. */}
                  {activeSection === 'Prerequisites' && <SetupPanel onDone={onClose} />}

                  {activeSection === 'Agents & Models' && (
                    <>
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Default agent model
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                            Every newly spawned Claude agent (Rudy included) starts on this model unless picked per-agent.
                            Marked “· default” in the model pickers.
                          </span>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {AGENT_MODELS.map((m) => (
                              <button
                                key={m.label}
                                onClick={() => { if (m.id) void saveDefaultModel(m.id); }}
                                style={{
                                  padding: '3px 8px 1px', border: 'none', cursor: 'pointer',
                                  fontFamily: 'var(--cth-font-ui)', fontSize: 12, color: 'var(--cth-ink-900)',
                                  background: defaultModelSel === m.id ? 'var(--cth-sky-light)' : 'var(--cth-cream-100)',
                                  boxShadow: defaultModelSel === m.id ? 'inset 0 0 0 1.5px var(--cth-ink-500)' : 'inset 0 0 0 1px var(--cth-ink-100)'
                                }}
                              >{m.label}</button>
                            ))}
                          </div>
                          {defaultModelNote && <span style={{ fontSize: 12, color: 'var(--cth-mint)' }}>{defaultModelNote}</span>}
                        </div>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />

                      <AiEnginesSettings config={config} />

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />

                      {/* Advanced */}
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Advanced
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 13, color: 'var(--cth-ink-900)' }}>Max turns per run</span>
                          <input
                            type="number" min="1" step="10" value={maxTurnsVal}
                            onChange={(e) => setMaxTurnsVal(e.target.value)}
                            onBlur={() => void saveMaxTurns()}
                            placeholder="unlimited"
                            style={{ ...slackInputStyle, width: 120 }}
                          />
                          <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>blank = unlimited</span>
                        </div>
                      </div>
                    </>
                  )}

                  {/* AUTONOMY & BUDGETS — the safety tab */}
                  {activeSection === 'Autonomy & Budgets' && (
                    <>
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Autonomy
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                              {autoModeOn ? 'Autonomous, agents act without asking' : 'Ask-first, agents pause for tool approval'}
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Applies to newly spawned agents (each agent's command can still override).
                            </span>
                          </div>
                          <PixelButton variant={autoModeOn ? 'primary' : 'secondary'} size="sm" onClick={toggleAutoMode}>
                            {autoModeOn ? 'autonomous' : 'ask-first'}
                          </PixelButton>
                        </div>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)', margin: '12px 0' }} />

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                              Who can add agents
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              {orchSpawnOn
                                ? 'Rudy can hire on his own. Every agent he starts spends tokens you did not approve.'
                                : 'Only you. Rudy can still ask, and his request waits in the queue instead of failing.'}
                            </span>
                          </div>
                          <PixelButton variant={orchSpawnOn ? 'primary' : 'secondary'} size="sm" onClick={toggleOrchSpawn}>
                            {orchSpawnOn ? 'me and Rudy' : 'only me'}
                          </PixelButton>
                        </div>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />

                      {/* Circuit breaker — the FULL unit (v0.3.4: all fields have UI) */}
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Circuit breaker
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Guard against runaway agents and spend. The breaker steers, then constrains, then stops an agent that crosses these.
                            </span>
                            <PixelToggle on={brkEnabled} onClick={() => { setBrkEnabled(!brkEnabled); }} />
                          </div>
                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...slackLabelStyle }}>
                              floor token budget
                              <input
                                type="number" min="0" step="100000" value={agentBudget}
                                onChange={(e) => setAgentBudget(e.target.value)}
                                placeholder="e.g. 1000000"
                                style={{ ...slackInputStyle, width: 180 }}
                              />
                              <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>
                                {fmtBudgetTokens(agentBudget) ? `= ${fmtBudgetTokens(agentBudget)} tokens` : 'total tokens across the floor'}
                              </span>
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...slackLabelStyle }}>
                              token velocity (tok/min)
                              <input
                                type="number" min="0" step="1000" value={velocityCeiling}
                                onChange={(e) => setVelocityCeiling(e.target.value)}
                                placeholder="e.g. 200000"
                                style={{ ...slackInputStyle, width: 180 }}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...slackLabelStyle }}>
                              repeated-tool limit
                              <input
                                type="number" min="0" step="5" value={brkRepeated}
                                onChange={(e) => setBrkRepeated(e.target.value)}
                                placeholder="default"
                                style={{ ...slackInputStyle, width: 140 }}
                              />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...slackLabelStyle }}>
                              error-storm limit
                              <input
                                type="number" min="0" step="5" value={brkErrStorm}
                                onChange={(e) => setBrkErrStorm(e.target.value)}
                                placeholder="default"
                                style={{ ...slackInputStyle, width: 140 }}
                              />
                            </label>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>Hard stop</span>
                              <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                                When tripped, KILL the agent instead of just constraining it. Off = steer-first (recommended).
                              </span>
                            </div>
                            <PixelButton variant={brkHardStop ? 'destructive' : 'secondary'} size="sm"
                              onClick={() => { setBrkHardStop(!brkHardStop); }}>
                              {brkHardStop ? 'kill on trip' : 'steer first'}
                            </PixelButton>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <PixelButton variant="secondary" size="sm" onClick={saveBudget}>save</PixelButton>
                            {budgetNote && <span style={{ fontSize: 12, color: 'var(--cth-mint)' }}>{budgetNote}</span>}
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {/* MEMORY & KNOWLEDGE */}
                  {activeSection === 'Memory & Knowledge' && (
                    <>
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Semantic memory
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>Cross-session recall</span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Agents' markdown memory is indexed for instant search. The embedding model lives in the Memory panel.
                            </span>
                          </div>
                          <PixelToggle on={semMemOn} onClick={toggleSemMem} />
                        </div>
                      </div>

                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />

                      {/* Knowledge Graph — enterprise multimodal context for agents */}
                      <div>
                        <div style={{
                          fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                          color: 'var(--cth-ink-500)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10
                        }}>
                          Knowledge Graph
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                              Give your agents reading material
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Drop in docs, images, and PDFs. While agents work they can search these files
                              and pull answers straight from them, instead of guessing.
                            </span>
                          </div>
                          <PixelToggle on={kgEnabled} onClick={toggleKg} />
                        </div>
                        {kgEnabled && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                            <PixelButton variant="secondary" size="sm" onClick={addKgFiles} disabled={kgBusy}>
                              {kgBusy ? 'adding…' : 'add files…'}
                            </PixelButton>
                            <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>
                              {kgDocCount} document{kgDocCount === 1 ? '' : 's'} indexed
                            </span>
                            {kgNote && <span style={{ fontSize: 12, color: 'var(--cth-mint)' }}>{kgNote}</span>}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* CONNECTIONS — everything external (MCP + Slack + webhook + REST) */}
                  {activeSection === 'Connections' && (
                    <>
                      <McpDefaultsSettings config={config} />
                      <div style={{ borderTop: '1px dashed var(--cth-ink-100)' }} />
                    </>
                  )}

                  {activeSection === 'Connections' && (
                    <>
                      {/* Custom REST APIs — the power-user registry, folded away
                          so it stops upstaging the account connects above. */}
                      <ConnCard
                        title="CUSTOM REST APIS"
                        blurb="Point agents at any HTTP API of your own: a base URL plus an optional auth header."
                      >
                        <IntegrationsRegistry />
                      </ConnCard>

                      {/* Slack integration */}
                      <ConnCard
                        title="SLACK"
                        blurb="A Slack channel's messages land straight in Rudy's queue. Slack does not allow a serverless one-click login, so this one takes the two tokens from your own Slack app (a hosted one-click is planned with rudydoes.com)."
                        status={<StatusDot on={running} onText="connected" offText={slackEnabled ? 'starting…' : 'off'} />}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>
                              Slack integration
                              {/* i - toggles the step-by-step connect guide. */}
                              <button
                                type="button"
                                aria-label="Show Slack connect steps"
                                aria-expanded={showSlackHelp}
                                onClick={() => setShowSlackHelp((v) => !v)}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  width: 16, height: 16, padding: 0, cursor: 'pointer',
                                  border: 'none', borderRadius: '50%',
                                  background: showSlackHelp ? 'var(--cth-ink-700)' : 'var(--cth-ink-300)',
                                  color: showSlackHelp ? 'var(--cth-paper-100)' : 'var(--cth-ink-900)',
                                  fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '16px'
                                }}
                              >i</button>
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Pipe a Slack channel's messages straight into Rudy's queue.
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {/* Connection status: clear, always-visible. */}
                            <span style={{
                              fontSize: 12, lineHeight: '16px',
                              color: running ? 'var(--cth-mint-700, #1f7a4d)' : 'var(--cth-ink-500)'
                            }}>
                              {running ? '● Connected' : '○ Not connected'}
                            </span>
                            <PixelToggle on={slackEnabled} onClick={() => setSlackEnabled((v) => !v)} />
                          </div>
                        </div>

                        {/* Step-by-step connect guide. Includes the both-lists
                            bot-event subscription requirement (steps 6 & 7). */}
                        {showSlackHelp && (
                          <pre style={{
                            margin: 0, padding: 10, whiteSpace: 'pre-wrap',
                            background: 'var(--cth-paper-100)',
                            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                            fontFamily: 'var(--cth-font-mono)', fontSize: 11, lineHeight: '16px',
                            color: 'var(--cth-ink-700)'
                          }}>{SLACK_CONNECT_STEPS}</pre>
                        )}

                        {slackEnabled && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {/* Signing secret + bot token side-by-side in the wider layout */}
                            <div style={{ display: 'flex', gap: 16 }}>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                <span style={slackLabelStyle}>Signing secret</span>
                                <input
                                  type="password"
                                  value={slackSecret}
                                  onChange={(e) => setSlackSecret(e.target.value)}
                                  placeholder="Slack app -> Basic Information -> Signing Secret"
                                  style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)' }}
                                />
                              </label>
                              {/* Bot token: stays in main; never leaves the main process. */}
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                <span style={slackLabelStyle}>Bot token</span>
                                <input
                                  type="password"
                                  value={slackBotToken}
                                  onChange={(e) => setSlackBotToken(e.target.value)}
                                  placeholder="xoxb-..."
                                  style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)' }}
                                />
                              </label>
                            </div>

                            <div style={{ display: 'flex', gap: 16 }}>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                <span style={slackLabelStyle}>Channel id (optional)</span>
                                <input
                                  value={slackChannel}
                                  onChange={(e) => setSlackChannel(e.target.value)}
                                  placeholder="C0123... or blank for any"
                                  style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)' }}
                                />
                              </label>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 100 }}>
                                <span style={slackLabelStyle}>Port</span>
                                <input
                                  type="number"
                                  value={slackPort}
                                  onChange={(e) => setSlackPort(e.target.value)}
                                  placeholder="3847"
                                  style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)' }}
                                />
                              </label>
                            </div>

                            {/* App/voice-INITIATED proactive posting — OFF by
                                default ("stop posting into Slack by default").
                                Gates ONLY the renderer's "queued" ack; the
                                Slack-ORIGIN done-reply round-trip is never gated. */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                              <span style={slackLabelStyle}>
                                Proactive posting (app-initiated), off by default
                              </span>
                              <PixelToggle on={slackProactivePosting} onClick={() => setSlackProactivePosting((v) => !v)} />
                            </div>

                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              {/* Start disabled once connected; Stop only when running. */}
                              <PixelButton variant="primary" size="sm" onClick={startSlack} disabled={slackBusy || !slackSecret.trim() || running}>
                                {slackBusy ? '...' : running ? 'connected' : 'start'}
                              </PixelButton>
                              <PixelButton variant="secondary" size="sm" onClick={stopSlack} disabled={slackBusy || !running}>
                                stop
                              </PixelButton>
                              <PixelButton variant="ghost" size="sm" onClick={saveSlack} disabled={slackBusy}>
                                save
                              </PixelButton>
                              {slackNote && (
                                <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{slackNote}</span>
                              )}
                            </div>

                            {/* Keep the Request URL visible while connected even after a
                                modal reopen; when stopped, show the last URL greyed
                                since Slack reuses it until the next Start. */}
                            {(running || tunnelUrl) && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: running ? 1 : 0.55 }}>
                                <span style={slackLabelStyle}>
                                  {running
                                    ? 'Request URL, paste into Slack Event Subscriptions'
                                    : 'last Request URL. Slack reuses it until you Stop'}
                                </span>
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <input
                                    readOnly
                                    value={tunnelUrl}
                                    onFocus={(e) => e.currentTarget.select()}
                                    style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)', fontSize: 12 }}
                                  />
                                  <PixelButton variant="secondary" size="sm" onClick={copyTunnel} disabled={!tunnelUrl}>copy</PixelButton>
                                </div>
                              </div>
                            )}

                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              In your Slack app: enable Event Subscriptions, add the{' '}
                              <code>message.channels</code> / <code>message.groups</code> bot event, set the
                              Request URL above, and reinstall to your workspace. The tunnel URL changes on every
                              restart, so re-paste it after pressing Start again.
                            </span>
                          </div>
                        )}
                      </ConnCard>

                      {/* iMessage via Photon */}
                      <ConnCard
                        title="IMESSAGE"
                        blurb="Text your office from your phone. Bring your own Photon project — Rudy connects with your credentials, so there is no middleman and nothing metering you."
                        status={<StatusDot on={photonRunning} onText="connected" offText={photonEnabled ? 'connecting…' : 'off'} />}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>
                              iMessage integration
                              <button
                                type="button"
                                aria-label="Show iMessage connect steps"
                                aria-expanded={showPhotonHelp}
                                onClick={() => setShowPhotonHelp((v) => !v)}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  width: 16, height: 16, padding: 0, cursor: 'pointer',
                                  border: 'none', borderRadius: '50%',
                                  background: showPhotonHelp ? 'var(--cth-ink-700)' : 'var(--cth-ink-300)',
                                  color: showPhotonHelp ? 'var(--cth-paper-100)' : 'var(--cth-ink-900)',
                                  fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '16px'
                                }}
                              >i</button>
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Text Rudy; approve with a tapback. No tunnel, no URL to paste.
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              fontSize: 12, lineHeight: '16px',
                              color: photonRunning ? 'var(--cth-mint-700, #1f7a4d)' : 'var(--cth-ink-500)'
                            }}>
                              {photonRunning ? '● Connected' : '○ Not connected'}
                            </span>
                            <PixelToggle on={photonEnabled} onClick={() => setPhotonEnabled((v) => !v)} />
                          </div>
                        </div>

                        {showPhotonHelp && (
                          <pre style={{
                            margin: 0, padding: 10, whiteSpace: 'pre-wrap',
                            background: 'var(--cth-paper-100)',
                            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                            fontFamily: 'var(--cth-font-mono)', fontSize: 11, lineHeight: '16px',
                            color: 'var(--cth-ink-700)'
                          }}>{PHOTON_CONNECT_STEPS}</pre>
                        )}

                        {photonEnabled && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'flex', gap: 16 }}>
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                <span style={slackLabelStyle}>Project ID</span>
                                <input
                                  value={photonProjectId}
                                  onChange={(e) => setPhotonProjectId(e.target.value)}
                                  placeholder="photon.codes -> your project"
                                  style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)' }}
                                />
                              </label>
                              {/* Write-only. Encrypted in main and never read back,
                                  so a blank box means "keep the saved one". */}
                              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                                <span style={slackLabelStyle}>
                                  Project secret{photonHasSecret ? ' (saved)' : ''}
                                </span>
                                <input
                                  type="password"
                                  value={photonSecret}
                                  onChange={(e) => setPhotonSecret(e.target.value)}
                                  placeholder={photonHasSecret ? 'leave blank to keep the saved one' : 'project secret'}
                                  style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)' }}
                                />
                              </label>
                            </div>

                            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span style={slackLabelStyle}>Allowed senders, comma separated</span>
                              <input
                                value={photonAllowlist}
                                onChange={(e) => setPhotonAllowlist(e.target.value)}
                                placeholder="+15551234567, you@icloud.com"
                                style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)' }}
                              />
                            </label>

                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              {/* Connect stays disabled without an allowlist: an
                                  ungated iMessage line is an open shell, and main
                                  refuses to open one anyway. */}
                              <PixelButton
                                variant="primary"
                                size="sm"
                                onClick={startPhoton}
                                disabled={photonBusy || !photonProjectId.trim() || photonHandles().length === 0
                                  || (!photonHasSecret && !photonSecret.trim()) || photonRunning}
                              >
                                {photonBusy ? '...' : photonRunning ? 'connected' : 'connect'}
                              </PixelButton>
                              <PixelButton variant="secondary" size="sm" onClick={stopPhoton} disabled={photonBusy || !photonRunning}>
                                disconnect
                              </PixelButton>
                              <PixelButton variant="ghost" size="sm" onClick={savePhoton} disabled={photonBusy}>
                                save
                              </PixelButton>
                              {photonNote && (
                                <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{photonNote}</span>
                              )}
                            </div>

                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              Every text waits for your 👍 before anything runs. Only the numbers and
                              emails listed above can reach this office; anyone else is ignored without
                              a reply. Your project secret is encrypted on this Mac and never shown again.
                            </span>
                          </div>
                        )}
                      </ConnCard>


                      {/* Webhook triggers — a LIST of endpoints, one per caller.
                          Everything renders off the store mirror, so a change made
                          in the Triggers tab lands here without a refetch (and the
                          other way round). */}
                      <ConnCard
                        title="WEBHOOKS"
                        blurb="A web address other apps can call to hand Rudy work. Skip this if nothing outside this machine needs to reach him."
                        status={<StatusDot on={webhookTriggers.length > 0} onText={`${webhookTriggers.length} endpoint${webhookTriggers.length === 1 ? '' : 's'}`} offText="none yet" />}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>
                              Webhook triggers
                              <button
                                type="button"
                                aria-label="Show webhook API format"
                                aria-expanded={showWebhookHelp}
                                onClick={() => setShowWebhookHelp((v) => !v)}
                                style={{
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  width: 16, height: 16, padding: 0, cursor: 'pointer',
                                  border: 'none', borderRadius: '50%',
                                  background: showWebhookHelp ? 'var(--cth-ink-700)' : 'var(--cth-ink-300)',
                                  color: showWebhookHelp ? 'var(--cth-paper-100)' : 'var(--cth-ink-900)',
                                  fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '16px'
                                }}
                              >i</button>
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              How it works: you create an endpoint here and give its URL + secret to one
                              app (GitHub, Stripe, a script). Whatever that app posts to the URL lands in
                              Rudy's queue as a message. One endpoint per app, so you can cut one off
                              without touching the others.
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{
                              fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap',
                              color: webhookRunning ? 'var(--cth-mint-700, #1f7a4d)' : 'var(--cth-ink-500)'
                            }}>
                              {webhookRunning ? '● listening' : '○ not listening'}
                            </span>
                            <PixelButton variant="primary" size="sm" onClick={addWebhook} disabled={webhookBusy}>
                              add webhook
                            </PixelButton>
                          </div>
                        </div>

                        {showWebhookHelp && (
                          <pre style={{
                            margin: 0, padding: 10, whiteSpace: 'pre-wrap',
                            background: 'var(--cth-paper-100)',
                            boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                            fontFamily: 'var(--cth-font-mono)', fontSize: 11, lineHeight: '16px',
                            color: 'var(--cth-ink-700)'
                          }}>{WEBHOOK_API_DOC}</pre>
                        )}

                        {/* Public surface warning. Loud, not buried. */}
                        <span style={{ fontSize: 12, lineHeight: '16px', color: '#6E1423' }}>
                          A switched-on webhook is reachable from the public internet: anyone who has its
                          secret can post to it. Share each secret with one app only. New webhooks start off.
                        </span>

                        {webhookTriggers.length === 0 ? (
                          <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                            No webhooks yet. Add one to give a tool a URL it can hand work to.
                          </span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {webhookTriggers.map((w) => {
                              const shown = shownSecrets[w.id] === true;
                              const endpoint = webhookEndpoint(w.id);
                              const modeBlurb = TRIGGER_MODES.find((m) => m.value === w.mode)?.blurb ?? '';
                              return (
                                <div
                                  key={w.id}
                                  style={{
                                    display: 'flex', flexDirection: 'column', gap: 8,
                                    padding: '10px 12px',
                                    background: 'var(--cth-cream-100)',
                                    boxShadow: `inset 0 0 0 ${w.enabled ? 1.5 : 1}px ${w.enabled ? 'var(--cth-ink-500)' : 'var(--cth-ink-100)'}`
                                  }}
                                >
                                  {/* Name, on/off, delete. Renaming is live in the
                                      mirror on every keystroke and persists on blur. */}
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <input
                                      value={w.name}
                                      onChange={(e) => { void patchWebhook(w.id, { name: e.target.value }, false); }}
                                      onBlur={() => { void applyWebhooks(webhookTriggers); }}
                                      placeholder="what calls this?"
                                      style={{ ...slackInputStyle, flex: 1 }}
                                    />
                                    <PixelToggle
                                      on={w.enabled}
                                      onClick={() => { void patchWebhook(w.id, { enabled: !w.enabled }); }}
                                      disabled={webhookBusy}
                                    />
                                    {/* Two clicks: deleting revokes a caller's access for good. */}
                                    <PixelButton
                                      variant={pendingDelete === w.id ? 'destructive' : 'ghost'}
                                      size="sm"
                                      onClick={() => {
                                        if (pendingDelete === w.id) void removeWebhook(w.id);
                                        else setPendingDelete(w.id);
                                      }}
                                      disabled={webhookBusy}
                                    >
                                      {pendingDelete === w.id ? 'sure?' : 'delete'}
                                    </PixelButton>
                                  </div>

                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <span style={{ ...slackLabelStyle, width: 56, flexShrink: 0 }}>URL</span>
                                    <input
                                      readOnly
                                      value={endpoint || 'starts once the webhook server is listening'}
                                      onFocus={(e) => e.currentTarget.select()}
                                      style={{
                                        ...slackInputStyle, fontFamily: 'var(--cth-font-mono)', fontSize: 12,
                                        color: endpoint ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)'
                                      }}
                                    />
                                    <PixelButton
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => { void window.cth.copyToClipboard(endpoint); }}
                                      disabled={!endpoint}
                                    >
                                      copy
                                    </PixelButton>
                                  </div>

                                  {/* Masked by default; never in a title attribute. */}
                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <span style={{ ...slackLabelStyle, width: 56, flexShrink: 0 }}>Secret</span>
                                    <input
                                      type={shown ? 'text' : 'password'}
                                      readOnly
                                      value={w.secret}
                                      onFocus={(e) => e.currentTarget.select()}
                                      style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)' }}
                                    />
                                    <PixelButton
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => setShownSecrets((s) => ({ ...s, [w.id]: !shown }))}
                                    >
                                      {shown ? 'hide' : 'show'}
                                    </PixelButton>
                                    <PixelButton
                                      variant="secondary"
                                      size="sm"
                                      onClick={() => { void window.cth.copyToClipboard(w.secret); }}
                                    >
                                      copy
                                    </PixelButton>
                                    <PixelButton
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => { void rotateWebhookSecret(w.id); }}
                                      disabled={webhookBusy}
                                    >
                                      rotate
                                    </PixelButton>
                                  </div>

                                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <span style={{ ...slackLabelStyle, width: 56, flexShrink: 0 }}>Mode</span>
                                    <select
                                      value={w.mode}
                                      onChange={(e) => { void patchWebhook(w.id, { mode: e.target.value as TriggerMode }); }}
                                      style={{ ...slackInputStyle, width: 160, flexShrink: 0 }}
                                    >
                                      {TRIGGER_MODES.map((m) => (
                                        <option key={m.value} value={m.value}>{m.label}</option>
                                      ))}
                                    </select>
                                    <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                                      {modeBlurb}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                          Callers POST to a webhook's URL with its secret in the{' '}
                          <code>x-md-webhook-secret</code> header. Each one checks bodies against its own JSON
                          schema, edit that in the Triggers tab of Rudy's Command Center, where the history
                          of everything that arrived lives too.
                        </span>

                        {webhookNote && (
                          <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{webhookNote}</span>
                        )}
                      </ConnCard>

                      {/* Organisation trigger — teammates messaging this clone node.
                          Persisted + mirrored; no transport reads the key yet. */}
                      <ConnCard
                        title="ORGANISATION"
                        blurb="A teammate's Rudy OS messaging yours. Settings only, not live yet."
                        status={<StatusDot on={orgTrigger.enabled} onText="armed" offText="off" />}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                              Organisation key
                            </span>
                            <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                              How a teammate's install addresses yours.
                            </span>
                          </div>
                          <PixelToggle
                            on={orgTrigger.enabled}
                            onClick={() => { void applyOrg({ ...orgTrigger, enabled: !orgTrigger.enabled }); }}
                            disabled={orgBusy}
                          />
                        </div>

                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span style={slackLabelStyle}>API key</span>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <input
                              type={showOrgKey ? 'text' : 'password'}
                              value={orgTrigger.apiKey}
                              onChange={(e) => { void applyOrg({ ...orgTrigger, apiKey: e.target.value }, false); }}
                              onBlur={() => { void applyOrg(orgTrigger); }}
                              placeholder="paste your organisation key"
                              style={{ ...slackInputStyle, fontFamily: 'var(--cth-font-mono)' }}
                            />
                            <PixelButton
                              variant="secondary"
                              size="sm"
                              onClick={() => setShowOrgKey((v) => !v)}
                              disabled={!orgTrigger.apiKey}
                            >
                              {showOrgKey ? 'hide' : 'show'}
                            </PixelButton>
                          </div>
                        </label>

                        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                          {CLONE_NODE_BLURB}
                        </span>

                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 200 }}>
                          <span style={slackLabelStyle}>Mode</span>
                          <select
                            value={orgTrigger.mode}
                            onChange={(e) => { void applyOrg({ ...orgTrigger, mode: e.target.value as TriggerMode }); }}
                            style={slackInputStyle}
                          >
                            {TRIGGER_MODES.map((m) => (
                              <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                          </select>
                        </label>
                        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                          {TRIGGER_MODES.find((m) => m.value === orgTrigger.mode)?.blurb ?? ''}
                        </span>

                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <PixelButton variant="ghost" size="sm" onClick={() => { void applyOrg(orgTrigger); }} disabled={orgBusy}>
                            save
                          </PixelButton>
                          {orgNote && (
                            <span style={{ fontSize: 12, color: 'var(--cth-ink-500)' }}>{orgNote}</span>
                          )}
                        </div>

                        <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                          Configuration only for now. The organisation messaging service does not exist yet, so a
                          key here starts no transport, it is saved, shown in the Triggers tab, and waits.
                        </span>
                      </ConnCard>

                    </>
                  )}

                  {/* About + credits. The office tileset credit is a LIVE licence
                      obligation (LimeZu Complete Version, see assets/ATTRIBUTION.md):
                      it must appear on an in-app surface, this is that surface. */}
                  {activeSection === 'General' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{
                        fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10, lineHeight: '12px',
                        color: 'var(--cth-ink-500)', textTransform: 'uppercase'
                      }}>About</div>
                      <span style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-500)' }}>
                        Rudy OS. Office tilesets by{' '}
                        <a
                          href="https://limezu.itch.io/"
                          onClick={(e) => { e.preventDefault(); void window.cth.openExternal('https://limezu.itch.io/'); }}
                          style={{ color: 'var(--cth-ink-700)', textDecoration: 'underline', cursor: 'pointer' }}
                        >LimeZu</a>, licensed. The cast is original Rudy OS art.
                      </span>
                    </div>
                  )}

                  {/* Danger — a red row at the bottom of General (was its own tab) */}
                  {activeSection === 'General' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <div style={{
                        fontFamily: 'var(--cth-font-display)', fontSize: 10, lineHeight: '14px',
                        color: '#6E1423'
                      }}>DANGER ZONE</div>
                      <p style={{ margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-700)' }}>
                        Reset wipes Rudy's memories, the entire hive (every agent, message,
                        task, and the board), the semantic-memory palace, and all settings -
                        then takes you back to onboarding.
                      </p>
                      <div>
                        <PixelButton variant="destructive" size="md" onClick={() => setConfirming(true)}>
                          reset &amp; start over
                        </PixelButton>
                      </div>
                    </div>
                  )}

                </div>
              </div>

              {/* Footer */}
              <div style={{
                borderTop: '2px solid var(--cth-ink-300)',
                padding: '10px 16px',
                display: 'flex', justifyContent: 'flex-end',
                background: 'var(--cth-cream-50)'
              }}>
                <PixelButton variant="secondary" size="md" onClick={onClose}>close</PixelButton>
              </div>
            </>
          )}
        </PixelPanel>
      </div>
    </div>
  );
}
