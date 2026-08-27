import { useEffect, useRef, useState } from 'react';
import { useStore, triggerHistoryVisible, type Agent } from '@/store/store';
import { startMockLoop, stopMockLoop } from '@/store/mockEvents';
import type { HarnessConfig } from '@/store/config';
import { DEFAULT_ORG_TRIGGER } from '@shared/triggers';
import { useHive } from '@/hooks/useHive';
import { AgentDetailPanel } from '@/components/AgentDetailPanel';
import { AddAgentModal } from '@/components/AddAgentModal';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { HivePicker } from '@/components/HivePicker';
import { QuitWarningModal, type ClosingTimeState } from '@/components/QuitWarningModal';
import { UpdateToast } from '@/components/UpdateToast';
import { useAppTheme, toggleAppTheme } from '@/design/theme';
import { SettingsModal, type Section as SettingsSection } from '@/components/SettingsModal';
import { acquireTerminal, notifyThemeChangeAll } from '@/components/terminalPool';
import { FullscreenTerminal } from '@/components/FullscreenTerminal';
import { TaskDetailOverlay } from '@/components/TaskDetailOverlay';
import { IdePanel } from '@/ide/IdePanel';
import { CC_TABS, CommandCenterTabBody, type CCTab } from '@/components/CommandCenterPanel';
import { HqBar } from '@/hq/HqBar';
import { HqDesk } from '@/hq/HqDesk';
import { HqOffice } from '@/hq/HqOffice';
import { HqFloor } from '@/hq/HqFloor';
import { HqSheet } from '@/hq/HqSheet';

// Injected at build time from package.json (see electron.vite.config.ts).
declare const __APP_VERSION__: string;

/** One sheet at a time over the desk: a module (Rudy's), a worker's console,
 *  or the office grown to full size. null means the desk is what you see. */
type Sheet = { kind: 'module'; tab: CCTab } | { kind: 'agent'; id: string } | { kind: 'office' } | null;

export function App() {
  const agents = useStore(s => s.agents);
  const agentCount = agents.length;
  const addAgentOpen = useStore(s => s.addAgentOpen);
  const setAddAgentOpen = useStore(s => s.setAddAgentOpen);
  const clearPendingHires = useStore(s => s.clearPendingHires);
  const bossStatus = useStore(s => s.bossStatus);
  const fullscreenAgentId = useStore(s => s.fullscreenAgentId);
  const appThemeNow = useAppTheme();
  const ideOpen = useStore(s => s.ideOpen);
  const setIdeOpen = useStore(s => s.setIdeOpen);

  const [config, setConfig] = useState<HarnessConfig | null>(null);
  // Whether the user has passed the launch-time hive picker this session. Starts
  // true (skip the picker) right after a hive SWITCH — changeHome relaunches and
  // leaves a one-shot localStorage flag so we don't bounce back onto the picker for
  // the hive we just chose. Also set true on onboarding completion (below).
  const [hiveOpened, setHiveOpened] = useState<boolean>(() => {
    try {
      if (window.localStorage.getItem('cth.skipHivePickerOnce')) {
        window.localStorage.removeItem('cth.skipHivePickerOnce');
        return true;
      }
    } catch { /* localStorage unavailable — show the picker */ }
    return false;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which tab Settings opens on. Set by a `cth:open-settings` deep link, reset
   *  to undefined (→ General) whenever the modal is opened the normal way. */
  const [settingsSection, setSettingsSection] = useState<SettingsSection | undefined>(undefined);
  const [quitWarn, setQuitWarn] = useState<{ ptyCount: number } | null>(null);
  const [closing, setClosing] = useState<ClosingTimeState | null>(null);
  // ── HQ: the sheet machinery ─────────────────────────────────────────
  const [sheet, setSheet] = useState<Sheet>(null);
  const selectedId = useStore((st) => st.selectedId);
  const selectAgent = useStore((st) => st.select);
  const showHistory = useStore(triggerHistoryVisible);
  const boss = agents.find((a) => a.isBoss) ?? null;
  const modules = CC_TABS.filter((t) => t.key !== 'trigger-history' || showHistory);

  /** Close whatever is open. The desk is Rudy's, so the selection returns
   *  to him: the IDE, focus mode and the floor all follow the selection. */
  const closeSheet = () => {
    setSheet(null);
    const st = useStore.getState();
    const g = st.agents.find((a) => a.isBoss);
    if (g && st.selectedId !== g.id) selectAgent(g.id);
  };
  /** A bar button. The terminal is the desk itself, so it reads as home;
   *  tapping the open module's button again closes it. */
  const openModule = (tab: CCTab) => {
    if (tab === 'terminal' || (sheet?.kind === 'module' && sheet.tab === tab)) { closeSheet(); return; }
    const g = useStore.getState().agents.find((a) => a.isBoss);
    if (g) selectAgent(g.id);
    setSheet({ kind: 'module', tab });
  };
  /** A floor card. Workers open as a sheet; Rudy is the desk, so his card
   *  just closes whatever covers it. */
  const pickAgent = (id: string) => {
    const a = useStore.getState().agents.find((x) => x.id === id);
    if (!a) return;
    if (a.isBoss) { closeSheet(); return; }
    selectAgent(id);
    setSheet({ kind: 'agent', id });
  };
  const growOffice = () => setSheet({ kind: 'office' });

  // A selection made elsewhere (a sprite on the floor, a task card) opens
  // that worker's sheet; selecting Rudy closes it. The first run is the
  // selection the last session left behind, not a click, so it is ignored.
  const prevSel = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevSel.current === undefined) { prevSel.current = selectedId; return; }
    if (prevSel.current === selectedId) return;
    prevSel.current = selectedId;
    const a = useStore.getState().agents.find((x) => x.id === selectedId);
    if (!a || a.isBoss) { setSheet((cur) => (cur?.kind === 'agent' ? null : cur)); return; }
    setSheet({ kind: 'agent', id: a.id });
  }, [selectedId]);
  // A worker whose sheet is open and who leaves the floor takes it with them.
  useEffect(() => {
    if (sheet?.kind !== 'agent') return;
    if (!agents.some((a) => a.id === sheet.id)) setSheet(null);
  }, [agents, sheet]);
  // At boot the desk is Rudy's, whatever the last session had selected.
  const seated = useRef(false);
  useEffect(() => {
    if (seated.current || !boss) return;
    seated.current = true;
    if (useStore.getState().selectedId !== boss.id) selectAgent(boss.id);
  }, [boss]);

  // Tab requests from the floor (the task board, the boss-room calendar, the
  // ask-me desk) open the matching sheet. seq-keyed so a repeat re-opens.
  const ccTabRequest = useStore((st) => st.ccTabRequest);
  const seenTabReq = useRef(0);
  useEffect(() => {
    if (!ccTabRequest || ccTabRequest.seq === seenTabReq.current) return;
    seenTabReq.current = ccTabRequest.seq;
    const tab = ccTabRequest.tab as CCTab;
    if (!CC_TABS.some((t) => t.key === tab)) return;
    if (tab === 'trigger-history' && !triggerHistoryVisible(useStore.getState())) return;
    if (tab === 'terminal') { setSheet(null); return; }
    setSheet({ kind: 'module', tab });
  }, [ccTabRequest]);
  // A task-detail "assign" seeds the dispatch box, which lives on the monitor.
  const dispatchSeedRequest = useStore((st) => st.dispatchSeedRequest);
  const seenSeed = useRef(0);
  useEffect(() => {
    if (!dispatchSeedRequest || dispatchSeedRequest.seq === seenSeed.current) return;
    seenSeed.current = dispatchSeedRequest.seq;
    setSheet({ kind: 'module', tab: 'floor' });
  }, [dispatchSeedRequest]);

  // Esc closes the sheet, unless something above it owns the key: focus mode,
  // the IDE, a modal, or a terminal that has the keyboard (Esc cancels a turn
  // there, and that must keep winning).
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const st = useStore.getState();
      if (st.fullscreenAgentId || st.ideOpen || st.addAgentOpen || st.taskDetailId) return;
      if (settingsOpen) return;
      const el = document.activeElement as HTMLElement | null;
      if (el?.closest('.xterm')) return;
      closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, settingsOpen]);

  const working = agents.filter((a) => a.status === 'working' || a.status === 'thinking' || a.status === 'looping' || a.status === 'compacting').length;
  const needs = agents.filter((a) => a.status === 'blocked' || a.status === 'waiting').length;

  const flipTheme = () => {
    const next = toggleAppTheme();
    // Tell every RUNNING program the theme flipped. xterm repaints its own
    // cells, but a TUI that painted its panels with explicit colours keeps
    // them until it redraws. Only programs that enabled DEC mode 2031 are
    // told, and it is every pooled terminal rather than the visible one.
    notifyThemeChangeAll(next === 'dark' ? 'dark' : 'light');
    // Mirror into the harness config: every agent (re)spawned from now on
    // gets the matching `theme` in its per-session Claude settings. Scoped to
    // harness agents; the user's global Claude theme is never touched.
    void window.cth.updateConfig({ terminalTheme: next });
  };
  /** A fresh Claude Code session in the harness home: same hive, clean
   *  context. Lands on the floor as an assistant seat and opens as a sheet.
   *  This is the answer to "the chat got huge, give me a new one". */
  const newSession = async () => {
    const home = config?.harnessHome;
    if (!home) return;
    const st = useStore.getState();
    const b = st.agents.find((a) => a.isBoss);
    const n = st.agents.filter((a) => a.isAssistant).length + 2;
    const id = `desk-${Date.now().toString(36)}`;
    const ptyId = `pty-${id}`;
    const cmd = (config?.defaultCommand || 'claude').trim();
    const [exe, ...args] = cmd.split(/\s+/);
    const res = await window.cth.spawnPty({
      id: ptyId, cwd: home, command: exe, provider: 'claude', args, cols: 100, rows: 30,
      hive: {
        // "Chat N", not "Desk N" — these are extra conversations with the same
        // brain, and users read "Desk 2" as a second person.
        id, name: `Chat ${n}`, provider: 'claude', cwd: home,
        role: 'a second Claude Code session at the boss desk: same harness, fresh context'
      }
    });
    if (!res.ok) { console.error('[new-session] spawn failed:', res.error); return; }
    useStore.getState().addAgent({
      id, name: `Chat ${n}`,
      character: b?.character ?? st.agents[0]?.character ?? ('rudy' as Agent['character']),
      accent: 'sky',
      description: 'fresh Claude Code in the harness',
      project: home.split('/').pop() ?? 'harness',
      tmuxTarget: '', cwd: res.cwd || home,
      status: 'idle', action: 'starting up', progress: 0,
      ptyId, command: cmd, provider: 'claude',
      isAssistant: true
    });
    selectAgent(id);
  };

  const toggleFocus = () => {
    if (fullscreenAgentId) { useStore.getState().setFullscreen(null); return; }
    const all = useStore.getState().agents;
    const target = all.find((x) => x.id === useStore.getState().selectedId && x.ptyId)
      ?? all.find((x) => x.isBoss && x.ptyId)
      ?? all.find((x) => x.ptyId);
    if (target) useStore.getState().setFullscreen(target.id);
  };

  // Deep link into Settings from anywhere in the tree. Settings' open state is
  // local to App, so a nested control (e.g. "set it now" beside a disabled Talk
  // button) has no path to it without threading a prop through every layer
  // between; a window event keeps that plumbing out of the components in
  // between, matching the existing `cth:` CustomEvent convention.
  useEffect(() => {
    const onOpenSettings = (e: Event): void => {
      const section = (e as CustomEvent<{ section?: SettingsSection }>).detail?.section;
      setSettingsSection(section);
      setSettingsOpen(true);
    };
    window.addEventListener('cth:open-settings', onOpenSettings);
    return () => window.removeEventListener('cth:open-settings', onOpenSettings);
  }, []);

  // Initial config load
  useEffect(() => {
    let cancelled = false;
    window.cth.getConfig().then(c => {
      if (cancelled) return;
      setConfig(c);
      // Mirror the triggers so Settings → Connections and the Command Center's
      // Triggers tab read one list, not two copies that drift — whichever surface
      // saves calls these same setters and the other repaints. No extra IPC: main
      // deep-fills both fields on every config read (withTriggerDefaults), so
      // getConfig() already serves what listWebhooks()/getOrgTrigger() would.
      // `c` is typed as the PRELOAD's HarnessConfig, which hasn't picked the two
      // fields up yet (another lane's file); the renderer mirror type declares them.
      const withTriggers = c as HarnessConfig;
      useStore.getState().setWebhookTriggers(withTriggers.webhookTriggers ?? []);
      useStore.getState().setOrgTrigger(withTriggers.orgTrigger ?? DEFAULT_ORG_TRIGGER);
    });
    return () => { cancelled = true; };
  }, []);


  // Quit warning subscription
  useEffect(() => window.cth.onCloseRequested((info) => setQuitWarn(info)), []);

  // Shareable hires: a validated manifest arriving via the rudyos://
  // deep link (or file import) pre-fills the Add-Agent modal. Never spawns by itself.
  const enqueuePendingHires = useStore(s => s.enqueuePendingHires);
  const closeAddAgentReview = () => {
    clearPendingHires();
    setAddAgentOpen(false);
  };
  useEffect(() => {
    const unsub = window.cth.onHireImport?.((m) => {
      enqueuePendingHires([m]);
      setAddAgentOpen(true);
    });
    // Pull anything that arrived before this subscription existed (cold-start
    // deep links; packaged renderers load too fast for push-on-load).
    void window.cth.drainPendingHires?.().then((queued) => {
      if (queued && queued.length > 0) {
        enqueuePendingHires(queued);
        setAddAgentOpen(true);
      }
    });
    return unsub;
  }, [enqueuePendingHires, setAddAgentOpen]);
  useEffect(() => window.cth.onHireError?.((info) => {
    console.error('[hire] import failed:', info.error);
  }), []);

  // Closing-time progress: drives the quit dialog's "wrapping up" view. The
  // dialog stays up through the whole protocol; on 'complete' the main process
  // tears down and quits by itself moments later.
  useEffect(() => window.cth.onClosingTime?.((ev) => {
    if (ev.phase === 'cancelled') { setClosing(null); return; }
    setClosing({ phase: ev.phase, acked: ev.acked, total: ev.total });
    if (ev.phase === 'started' || ev.phase === 'progress') setQuitWarn((w) => w ?? { ptyCount: 0 });
  }), []);

  const startClosingTime = async () => {
    const res = await window.cth.startClosingTime();
    if (!res.ok) setClosing({ phase: 'error', acked: 0, total: 0, error: res.error });
  };
  const cancelClosingTime = () => {
    void window.cth.cancelClosingTime();
    setClosing(null);
  };

  // The hive: boss-agent bootstrap, hook-driven avatars, idle-agent waking. Held
  // off until the user opens a hive in the launch picker (passing null no-ops the
  // hook) so Rudy doesn't boot against the current home while the user may be
  // about to switch to a different one.
  useHive(hiveOpened ? config : null);

  // Pre-warm a persistent terminal for every live agent so its output is
  // buffered from spawn. Switching agents then re-attaches an already-rendered
  // terminal instantly (with full history) instead of building a blank one.
  useEffect(() => {
    for (const a of agents) if (a.ptyId) acquireTerminal(a.ptyId);
  }, [agents]);

  // Synthetic demo loop — CAGED (#5B). It must never animate alongside a live
  // hive (it would fire fake envelope handoffs and step seeded agents). Run it
  // only as an explicit showcase (VITE_CTH_DEMO=1 in dev) or on a genuinely
  // empty floor, and stop it the instant the first real PTY agent appears
  // (Rudy always spawns, so in normal operation it effectively never runs).
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    const DEMO = import.meta.env.DEV && import.meta.env.VITE_CTH_DEMO === '1';
    const evaluate = () => {
      const hasLive = useStore.getState().agents.some((a) => a.ptyId);
      if (DEMO || !hasLive) startMockLoop();
      else stopMockLoop();
    };
    evaluate();
    const unsub = useStore.subscribe(evaluate);
    return () => { unsub(); stopMockLoop(); };
  }, [config?.onboardingComplete]);

  // Reconcile restored agents against the PTYs still alive in the main process.
  // After a renderer reload (e.g. the laptop slept and Vite reloaded the page),
  // this keeps agents whose process survived and drops any that truly died.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    let cancelled = false;
    window.cth.listPtys().then((list) => {
      if (cancelled) return;
      useStore.getState().reconcileWithLivePtys(list.map((p) => p.id));
    }).catch(() => { /* ignore — keep restored agents as-is */ });
    return () => { cancelled = true; };
  }, [config?.onboardingComplete]);

  // Re-apply the persisted focus-mode preference as the roster fills in.
  //
  // Not a one-shot at store construction: at launch every restored agent still
  // carries the PREVIOUS session's PTY id, so the reconcile above prunes the lot
  // and correctly drops focus mode to null before boss has respawned. The
  // preference therefore has to be re-checked once agents with live terminals
  // actually exist. `restoreFocusMode` is a no-op unless the preference is on and
  // focus mode is currently off, so re-running it on every roster change is safe
  // and pressing Esc stays sticky.
  useEffect(() => {
    if (!config?.onboardingComplete) return;
    useStore.getState().restoreFocusMode();
  }, [config?.onboardingComplete, agents]);

  if (!config) {
    return <div style={{ width: '100vw', height: '100vh', background: 'var(--cth-cream-100)' }} />;
  }

  if (!config.onboardingComplete) {
    // Just-onboarded users go straight into the hive they set up — skip the picker.
    return <OnboardingWizard onComplete={(next) => { setConfig(next); setHiveOpened(true); }} />;
  }

  // Launch-time hive picker: on reopen, let the user open their current hive,
  // switch to a recent one, or open/create another. Skipped right after onboarding
  // and right after a switch-relaunch (see hiveOpened init).
  if (!hiveOpened) {
    return <HivePicker config={config} onOpenCurrent={() => setHiveOpened(true)} />;
  }

  const sheetAgent = sheet?.kind === 'agent' ? agents.find((a) => a.id === sheet.id) ?? null : null;
  const activeModule: CCTab | null = sheet === null ? 'terminal' : sheet.kind === 'module' ? sheet.tab : null;
  // Agent sheets get a ROLE word up top, not the agent's name — the console
  // head right below already prints the name, and "Desk 2" twice in a row
  // read as a bug.
  const sheetTitle = sheet?.kind === 'module'
    ? (CC_TABS.find((t) => t.key === sheet.tab)?.label ?? sheet.tab)
    : sheetAgent
      ? (sheetAgent.isAssistant ? 'SESSION' : 'WORKER')
      : '';

  return (
    <div className="hq-root">
      <div className="aur-blob b1" /><div className="aur-blob b2" /><div className="aur-blob b3" />
      {/* rt-12: global fixed-overlay toast for voice-Rudy completions ("an agent
          finished X"). Self-positions bottom-right; renders null until one arrives. */}
      {/* v0.3.4: background-update toast ("restart to update"); renders null until
          main's updater pushes a status. */}
      <UpdateToast />

      {/* ONE slim bar: brand, pulse, theme, settings, focus. */}
      <HqBar
        working={working}
        needs={needs}
        autoMode={!!config.autoMode}
        theme={appThemeNow === 'dark' ? 'dark' : 'light'}
        onTheme={flipTheme}
        onSettings={() => { setSettingsSection(undefined); setSettingsOpen(true); }}
        onIde={() => setIdeOpen(true)}
        onFocus={toggleFocus}
        focusOn={!!fullscreenAgentId}
      />

      <div className="hq-body">
        {/* work, left: Rudy's desk */}
        <div className="hq-main">
          <HqDesk
            boss={boss}
            bossStatus={bossStatus}
            agentCount={agentCount}
            modules={modules}
            active={activeModule}
            needsCount={needs}
            onModule={openModule}
            onNewSession={() => { void newSession(); }}
            onHire={() => setAddAgentOpen(true)}
          />
        </div>

        {/* the world, right: the office as a window, then the floor, triaged */}
        <div className="hq-world">
          <HqOffice
            grown={sheet?.kind === 'office'}
            onGrow={growOffice}
            onShrink={closeSheet}
            booting={agentCount === 0 && bossStatus === 'booting'}
          />
          <HqFloor
            selectedId={selectedId}
            onPick={pickAgent}
            onHire={() => setAddAgentOpen(true)}
          />
        </div>

        {/* sheets: the office grown, a module, or a worker's console */}
        {sheet?.kind === 'office' && <div className="hq-scrim" onClick={closeSheet} aria-hidden="true" />}
        {sheet && sheet.kind !== 'office' && (
          <HqSheet title={sheetTitle} onClose={closeSheet}>
            {sheet.kind === 'module' && boss && (
              <div className="hq-sheet-module">
                <CommandCenterTabBody
                  agent={boss}
                  tab={sheet.tab}
                  onSwitchTab={(t) => setSheet({ kind: 'module', tab: t })}
                />
              </div>
            )}
            {sheet.kind === 'module' && !boss && (
              <div className="hq-empty">
                <div className="hq-empty-k">NOT YET</div>
                <div className="hq-empty-t">Rudy is not seated.</div>
                <p className="hq-empty-p">His modules open once he is at the desk.</p>
              </div>
            )}
            {sheetAgent && (
              <div className="hq-sheet-worker">
                <AgentDetailPanel agent={sheetAgent} />
              </div>
            )}
          </HqSheet>
        )}
        {sheet && <div className="hq-hint">CLICK OUTSIDE OR PRESS ESC TO CLOSE</div>}
      </div>

      {addAgentOpen && (
        <AddAgentModal
          onClose={closeAddAgentReview}
          config={config}
          onConfigChange={setConfig}
        />
      )}

      {settingsOpen && (
        <SettingsModal
          config={config}
          initialSection={settingsSection}
          onClose={() => { setSettingsOpen(false); setSettingsSection(undefined); }}
        />
      )}

      {quitWarn && (
        <QuitWarningModal
          ptyCount={quitWarn.ptyCount}
          closing={closing}
          onCancel={() => {
            if (closing) cancelClosingTime();
            window.cth.cancelClose();
            setQuitWarn(null);
          }}
          onConfirm={async () => { await window.cth.confirmClose(); }}
          onClosingTime={startClosingTime}
        />
      )}

      {fullscreenAgentId && <FullscreenTerminal config={config} />}
      {ideOpen && <IdePanel />}
      <TaskDetailOverlay />
    </div>
  );
}
