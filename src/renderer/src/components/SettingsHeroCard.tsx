/**
 * The hero card at the top of Settings → General.
 *
 * One card that answers "what is this install, and what can I do about it" —
 * the running version, the plan it is on, and the handful of actions that do not
 * belong to any individual setting below (re-read the release notes, star, back
 * the project).
 *
 * Its contents come from docs/hero.json IN THIS REPO, fetched at runtime and
 * cached — so plan copy, a sponsor, or a one-line notice can change without
 * shipping a build. That payload is DATA, never markup: every field below is a
 * React text node, so it is escaped, and shared/heroPayload.ts validates types,
 * caps lengths and requires https before any of it reaches here.
 *
 * It renders instantly from the app's built-in defaults and upgrades in place
 * when the fetch lands, so the dialog never waits on the network and reads the
 * same offline. A sponsor slot with nothing in it renders NOTHING rather than a
 * "your logo here" placeholder.
 *
 * Since 0.4.5 it borrows the release drop's idiom (ink borders, a lilac
 * announcement block, a dark offer band) and carries the v0.5.0 Pro announcement and the
 * Founders' Wall offer, so the one card people see in Settings says the same
 * thing the release modal does. Plan label and blurb still come from hero.json.
 */
import { useEffect, useState } from 'react';
import { PixelButton } from './PixelButton';
import { Icon } from './Icon';
import { DEFAULT_HERO, type HeroPayload } from '@shared/heroPayload';
import { manualDownloadUrl, pendingVersion, reduceStatus, type UpdateStatus } from '@shared/updateState';


export function SettingsHeroCard() {
  const [version, setVersion] = useState<string | null>(null);
  // Starts on the compiled-in defaults, so there is no empty frame or spinner
  // while the fetch is in flight — it just fills in if anything changed.
  const [hero] = useState<HeroPayload>(DEFAULT_HERO);
  /** Whatever release the updater knows about, so the card can offer the
   *  manual download right where the version is shown. */
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    const off = window.cth.onUpdateStatus?.((next) => setStatus((prev) => reduceStatus(prev, next)));
    void window.cth.updateCurrent?.().then((cur) => {
      if (cur) setStatus((prev) => reduceStatus(prev, cur));
    }).catch(() => { /* push channel still works */ });
    return off;
  }, []);
  const pending = version ? pendingVersion(status, version) : null;
  const downloadManually = () => {
    if (!status) return;
    const url = manualDownloadUrl(status, window.cth.platform, window.cth.arch);
    if (url) void window.cth.updateOpenRelease(url);
  };

  useEffect(() => {
    let alive = true;
    window.cth.appInfo()
      .then((i) => { if (alive) setVersion(i.version); })
      .catch(() => { /* the card is still useful without it */ });
    return () => { alive = false; };
  }, []);

  const PLAN = hero.plan;
  const SPONSOR = hero.sponsor;

  /** Re-show the release notes. UpdateToast owns that surface — it holds the
   *  last status and the drop renderer — so this asks rather than duplicating
   *  it, via the same CustomEvent convention App uses for opening Settings. */
  const showReleaseNotes = () => {
    window.dispatchEvent(new CustomEvent('cth:show-release-notes'));
  };

  const INK = 'var(--cth-ink-900)';
  const MONO = 'var(--cth-font-mono, monospace)';

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      background: 'var(--cth-paper-100)',
      border: `2px solid ${INK}`
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14 }}>
        {/* Identity: name, the running version in plain sight, the plan. */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: 'var(--cth-font-display)', fontSize: 13, lineHeight: '20px', color: INK
            }}>RUDY OS</span>
            {version && (
              <span style={{
                fontFamily: MONO, fontSize: 13, fontWeight: 700, color: INK
              }}>v{version}</span>
            )}
            <span style={{
              fontFamily: MONO, fontSize: 9, letterSpacing: '.12em', textTransform: 'uppercase',
              padding: '2px 7px', background: 'var(--cth-mint-light)',
              boxShadow: 'inset 0 0 0 1px var(--cth-mint)', color: INK
            }}>{PLAN.label}</span>
            {pending && (
              <>
                <span style={{ flex: 1 }} />
                <span style={{ fontFamily: MONO, fontSize: 11, color: 'var(--cth-ink-700)' }}>
                  v{pending} is out
                </span>
                <PixelButton variant="primary" size="sm" onClick={downloadManually}
                  title="Download the installer and replace the app yourself. Auto-update is in Updates below.">
                  download v{pending}
                </PixelButton>
              </>
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5, color: 'var(--cth-ink-700)', maxWidth: '64ch' }}>
            {PLAN.blurb}
          </div>
        </div>

        {/* A one-line notice (an incident, a migration heads-up), when set. */}
        {hero.notice && (
          <div style={{
            padding: '8px 10px', fontSize: 12, lineHeight: 1.5, color: INK,
            background: 'var(--cth-lemon-light)', border: `2px solid ${INK}`
          }}>{hero.notice}</div>
        )}

        {/* Sponsor — only when there is one. */}
        {SPONSOR && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: 10,
            background: 'var(--cth-cream-100)',
            border: `2px solid ${INK}`
          }}>
            <span style={{
              fontFamily: MONO, fontSize: 9, letterSpacing: '.18em',
              textTransform: 'uppercase', color: 'var(--cth-ink-500)', flexShrink: 0
            }}>Sponsored by</span>
            <span style={{ fontSize: 13, color: INK, flexShrink: 0 }}>{SPONSOR.name}</span>
            <span style={{ flex: 1, minWidth: 120, fontSize: 12, color: 'var(--cth-ink-700)' }}>{SPONSOR.blurb}</span>
            <PixelButton variant="ghost" size="sm" onClick={() => void window.cth.openExternal(SPONSOR.url)}>
              visit
            </PixelButton>
          </div>
        )}

        {/* Actions that belong to the app rather than to any setting below. */}
        <div style={{
          display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
          paddingTop: 12, borderTop: `2px solid ${INK}`
        }}>
          <PixelButton variant="secondary" size="sm" onClick={showReleaseNotes}>
            <span title="Show the release notes for the update you were last told about"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Icon name="sparkle" /> what&rsquo;s new
            </span>
          </PixelButton>
          <span style={{ flex: 1 }} />
        </div>
      </div>
    </div>
  );
}
