import { useEffect, useState } from 'react';
import type { HarnessConfig } from '@/store/config';
import { MCP_CATALOG } from '@shared/mcpCatalog';
import { PixelToggle } from './PixelToggle';
import { PixelButton } from './PixelButton';

export interface McpDefaultsSettingsProps {
  config: HarnessConfig;
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--cth-font-ui)', fontWeight: 700,
  fontSize: 10,
  lineHeight: '12px',
  color: 'var(--cth-ink-500)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase'
};

export function McpDefaultsSettings({ config }: McpDefaultsSettingsProps) {
  const [note, setNote] = useState('');
  // THE BUG this fixes: `config` is a snapshot taken when Settings opened and
  // is never refreshed after updateConfig — so a toggle saved fine, flashed
  // "enabled", and the row still painted OFF from the stale prop. Local
  // overrides carry every change made in this session; the prop only seeds.
  const [local, setLocal] = useState<Record<string, boolean>>({});
  // Keyed servers: which have a credential stored (boolean only), plus the
  // write-only input drafts. The key itself never comes back over IPC.
  const [hasKey, setHasKey] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  // With a one-click connect on the row, the paste field is the FALLBACK, not
  // the greeting — it stays folded behind a quiet link until asked for.
  const [showPaste, setShowPaste] = useState<Record<string, boolean>>({});
  // One-click connects: which providers have an OAuth app baked into this
  // build. When absent, the row falls back to the paste field alone.
  const [oauthReady, setOauthReady] = useState<{ github: boolean; google: boolean }>({ github: false, google: false });
  // Live connect state per entry: idle | a user code to type | waiting | error.
  const [connect, setConnect] = useState<Record<string, { phase: 'code' | 'waiting'; userCode?: string } | { phase: 'error'; message: string }>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, boolean> = {};
      for (const e of MCP_CATALOG) {
        if (!e.spec.env) continue;
        try { out[e.id] = await window.cth.mcpKeyHas(e.id); } catch { out[e.id] = false; }
      }
      let gh = false, gg = false;
      try { gh = await window.cth.mcpOauthGithubAvailable(); } catch { /* older main */ }
      try { gg = await window.cth.mcpOauthGoogleAvailable(); } catch { /* older main */ }
      if (alive) { setHasKey(out); setOauthReady({ github: gh, google: gg }); }
    })();
    return () => { alive = false; };
  }, []);

  const connectGithub = async () => {
    const start = await window.cth.mcpOauthGithubStart();
    if (!start.ok) { setConnect((s) => ({ ...s, 'github-token': { phase: 'error', message: start.error ?? 'could not start' } })); return; }
    setConnect((s) => ({ ...s, 'github-token': { phase: 'code', userCode: start.userCode } }));
    const done = await window.cth.mcpOauthGithubWait();
    if (done.ok) {
      setHasKey((s) => ({ ...s, 'github-token': true }));
      setConnect((s) => { const { 'github-token': _gone, ...rest } = s; return rest; });
      // Connected means ON — nobody signs in to keep a thing disabled.
      if (!enabledFor('github-token')) void writeEnabled('github-token', true, true);
      setNote('github: connected');
      setTimeout(() => setNote(''), 2000);
    } else {
      setConnect((s) => ({ ...s, 'github-token': { phase: 'error', message: done.error ?? 'failed' } }));
    }
  };
  const connectGoogle = async () => {
    setConnect((s) => ({ ...s, 'email-calendar': { phase: 'waiting' } }));
    const done = await window.cth.mcpOauthGoogleConnect();
    if (done.ok) {
      setHasKey((s) => ({ ...s, 'email-calendar': true }));
      setConnect((s) => { const { 'email-calendar': _gone, ...rest } = s; return rest; });
      if (!enabledFor('email-calendar')) void writeEnabled('email-calendar', true, true);
      setNote('google: connected');
      setTimeout(() => setNote(''), 2000);
    } else {
      setConnect((s) => ({ ...s, 'email-calendar': { phase: 'error', message: done.error ?? 'failed' } }));
    }
  };

  const saveKey = async (id: string) => {
    const key = (draft[id] ?? '').trim();
    if (!key) return;
    try {
      const r = await window.cth.mcpKeySet({ id, key });
      if (r.ok) {
        setHasKey((s) => ({ ...s, [id]: true }));
        setDraft((s) => ({ ...s, [id]: '' }));
        if (!enabledFor(id)) void writeEnabled(id, true, true);
        setNote(`${id}: key saved`);
      } else setNote(r.error ?? 'could not save the key');
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)); }
    setTimeout(() => setNote(''), 2000);
  };
  const clearKey = async (id: string) => {
    try {
      await window.cth.mcpKeyClear(id);
      setHasKey((s) => ({ ...s, [id]: false }));
      setNote(`${id}: key removed`);
      setTimeout(() => setNote(''), 2000);
    } catch { /* noop */ }
  };

  const enabledFor = (id: string): boolean =>
    local[id]
    ?? config.mcpDefaults?.[id]?.enabled
    ?? MCP_CATALOG.find((e) => e.id === id)?.defaultEnabled
    ?? false;

  const writeEnabled = async (id: string, next: boolean, quiet = false) => {
    setLocal((s) => ({ ...s, [id]: next }));
    try {
      // Merge over the stored map PLUS this session's flips, so two toggles in
      // one Settings visit don't overwrite each other with stale prop data.
      const merged: Record<string, { enabled: boolean }> = { ...(config.mcpDefaults ?? {}) };
      for (const [k, v] of Object.entries({ ...local, [id]: next })) merged[k] = { enabled: v };
      await window.cth.updateConfig({ mcpDefaults: merged });
      if (!quiet) {
        setNote(`${id}: ${next ? 'enabled' : 'disabled'}`);
        setTimeout(() => setNote(''), 1800);
      }
      return true;
    } catch {
      setLocal((s) => ({ ...s, [id]: !next }));
      setNote('could not save');
      setTimeout(() => setNote(''), 2000);
      return false;
    }
  };

  const toggle = async (id: string) => {
    const next = !enabledFor(id);
    const ok = await writeEnabled(id, next);
    // Switching ON a row that has a one-click connect and no credential yet IS
    // the ask to connect — start the flow instead of sitting there switched on
    // but dead. The button stays for retries.
    if (ok && next && !hasKey[id] && !connect[id]) {
      if (id === 'github-token' && oauthReady.github) void connectGithub();
      if (id === 'email-calendar' && oauthReady.google) void connectGoogle();
    }
  };

  // The four connections people actually mean by "connect my stuff", in the
  // order they ask for them. Everything else is the agent toolkit below.
  const ACCOUNTS = ['github-token', 'email-calendar', 'db', 'web-search'];
  const accounts = ACCOUNTS
    .map((id) => MCP_CATALOG.find((e) => e.id === id))
    .filter((e): e is (typeof MCP_CATALOG)[number] => !!e);
  const toolkit = MCP_CATALOG.filter((e) => !ACCOUNTS.includes(e.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* ── YOUR ACCOUNTS — the headline of the Connections tab ── */}
      <div>
        <div style={{ ...labelStyle, marginBottom: 4 }}>Connect your accounts</div>
        <span style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-500)' }}>
          What agents can reach on your behalf. Changes apply to the next agent spawn.
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {accounts.map((entry) => {
          const on = enabledFor(entry.id);
          const keyed = !!entry.spec.env;
          const keyStored = hasKey[entry.id] === true;
          const connected = !keyed || keyStored;
          const oauth = (entry.id === 'github-token' && oauthReady.github)
            || (entry.id === 'email-calendar' && oauthReady.google);
          const st = connect[entry.id];
          return (
            <div
              key={entry.id}
              style={{
                display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px',
                background: 'var(--cth-paper-100)',
                boxShadow: `inset 0 0 0 ${on && connected ? 1.5 : 1}px ${on && connected ? 'var(--cth-mint)' : 'var(--cth-ink-300)'}`
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span aria-hidden style={{
                  width: 8, height: 8, flexShrink: 0,
                  background: connected && on ? 'var(--cth-mint)' : keyed && !keyStored ? 'var(--cth-ink-300)' : 'var(--cth-lemon)'
                }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                  <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 11.5, lineHeight: '16px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                    {entry.label}
                  </span>
                  <span style={{ fontSize: 12, lineHeight: '16px', color: 'var(--cth-ink-500)' }}>
                    {entry.description}
                  </span>
                </div>
                <PixelToggle on={on} onClick={() => { void toggle(entry.id); }} />
              </div>

              {keyed && !keyStored && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {oauth && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <PixelButton
                        variant="primary" size="sm"
                        disabled={st?.phase === 'code' || st?.phase === 'waiting'}
                        onClick={() => { void (entry.id === 'github-token' ? connectGithub() : connectGoogle()); }}
                      >
                        {entry.id === 'github-token' ? 'connect github' : 'connect google'}
                      </PixelButton>
                      {!st && <span style={{ fontSize: 11, color: 'var(--cth-ink-500)' }}>opens your browser, you approve, done</span>}
                      {st?.phase === 'code' && (
                        <span style={{ fontSize: 11, color: 'var(--cth-ink-700)' }}>
                          code <code style={{ fontFamily: 'var(--cth-font-mono)', fontWeight: 700 }}>{st.userCode}</code> is on your clipboard, paste it in the browser tab that just opened…
                        </span>
                      )}
                      {st?.phase === 'waiting' && <span style={{ fontSize: 11, color: 'var(--cth-ink-700)' }}>waiting for your approval in the browser…</span>}
                      {st?.phase === 'error' && <span style={{ fontSize: 11, color: '#6E1423' }}>{st.message}</span>}
                    </div>
                  )}
                  {oauth && !showPaste[entry.id] ? (
                    <button
                      type="button"
                      onClick={() => setShowPaste((s) => ({ ...s, [entry.id]: true }))}
                      style={{
                        alignSelf: 'flex-start', padding: 0, border: 'none', background: 'none',
                        cursor: 'pointer', fontFamily: 'var(--cth-font-ui)', fontSize: 11,
                        color: 'var(--cth-ink-500)', textDecoration: 'underline'
                      }}
                    >
                      paste a token by hand instead
                    </button>
                  ) : (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="password"
                      autoComplete="off"
                      value={draft[entry.id] ?? ''}
                      onChange={(e) => setDraft((s) => ({ ...s, [entry.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') void saveKey(entry.id); }}
                      placeholder={entry.secretHint ?? 'paste the key'}
                      style={{
                        flex: 1, padding: '5px 8px 4px', background: 'var(--cth-cream-100)',
                        border: 'none', boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)',
                        fontFamily: 'var(--cth-font-mono)', fontSize: 12, color: 'var(--cth-ink-900)', outline: 'none'
                      }}
                    />
                    <PixelButton variant="secondary" size="sm" onClick={() => void saveKey(entry.id)} disabled={!(draft[entry.id] ?? '').trim()}>
                      save key
                    </PixelButton>
                  </div>
                  )}
                  {on && (
                    <span style={{ fontSize: 11, lineHeight: '15px', color: '#6E1423' }}>
                      Switched on but NOT connected yet: agents skip it until you connect or paste a key.
                    </span>
                  )}
                </div>
              )}
              {keyed && keyStored && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-500)', flex: 1 }}>
                    Connected. The credential is encrypted on this machine; agents pick it up on their next spawn.
                  </span>
                  <PixelButton variant="ghost" size="sm" onClick={() => void clearKey(entry.id)}>disconnect</PixelButton>
                </div>
              )}
              {!keyed && (
                <span style={{ fontSize: 11, lineHeight: '15px', color: 'var(--cth-ink-500)' }}>
                  No account needed, it just works.
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* ── AGENT TOOLKIT — the quiet utilities, compact ── */}
      <div>
        <div style={{ ...labelStyle, marginBottom: 4 }}>Agent toolkit</div>
        <span style={{ fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-500)' }}>
          Built-in abilities every new agent gets: reading time, fetching pages, docs lookups, and
          workspace-scoped files and git. Safe and read-only; switch any off if you prefer.
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {toolkit.map((entry) => {
          const on = enabledFor(entry.id);
          return (
            <div
              key={entry.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '6px 10px',
                background: 'var(--cth-paper-100)',
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-100)'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--cth-font-ui)', fontWeight: 700, fontSize: 10.5, lineHeight: '15px', letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--cth-ink-900)' }}>
                  {entry.label}
                </span>
                <span style={{ fontSize: 11.5, lineHeight: '15px', color: 'var(--cth-ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.description}
                </span>
              </div>
              <PixelToggle on={on} onClick={() => { void toggle(entry.id); }} />
            </div>
          );
        })}
      </div>

      {note && (
        <span style={{ fontSize: 12, color: 'var(--cth-mint)' }}>{note}</span>
      )}
    </div>
  );
}
