import { type SidebarTab } from '@/store/store';
import { type AccentColorName } from '@/design/tokens';
import { Icon, type IconName } from './Icon';

// v0.3.4: the files tab is gone — the per-agent IDE button (header) opens the
// full Monaco editor + file tree, which superseded the read-only browser.
const TABS: { key: SidebarTab; label: string; icon: IconName }[] = [
  { key: 'terminal', label: 'terminal', icon: 'terminal' },
  { key: 'git',      label: 'git',      icon: 'code' },
  { key: 'messages', label: 'messages', icon: 'bell' },
  { key: 'traces',   label: 'traces',   icon: 'web' }
];

export interface SidebarTabsProps {
  current: SidebarTab;
  accent: AccentColorName;
  onChange: (tab: SidebarTab) => void;
}

export function SidebarTabs({ current, accent, onChange }: SidebarTabsProps) {
  void accent;
  return (
    // Same voice as the Command Center's tab strip: quiet bold-caps text with
    // a red underline on the active tab. The old boxed pixel-font tabs were
    // the last strip still speaking the previous app's language.
    <div style={{
      display: 'flex',
      gap: 2,
      background: 'var(--cth-cream-100)',
      borderBottom: '1px solid var(--cth-ink-300)',
      flexShrink: 0
    }}>
      {TABS.map(t => {
        const active = current === t.key;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            style={{
              flex: 1,
              height: 32,
              padding: '0 10px',
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
              boxShadow: active ? 'inset 0 -2px 0 var(--cth-brand-red)' : 'none',
              fontFamily: 'var(--cth-font-ui)',
              fontWeight: 700,
              fontSize: 10,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: active ? 'var(--cth-ink-900)' : 'var(--cth-ink-500)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6
            }}
          >
            <Icon name={t.icon} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}
