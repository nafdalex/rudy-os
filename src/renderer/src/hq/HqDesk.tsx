import { useStore, type Agent, type BossStatus } from '@/store/store';
import { CommandCenterPanel, CC_TABS, type CCTab } from '@/components/CommandCenterPanel';
import { PixelBadge } from '@/components/PixelBadge';
import { Icon } from '@/components/Icon';
import { useFloorDelivery } from '@/hooks/useFloorDelivery';
import { RudyFace } from './RudyFace';

type Module = (typeof CC_TABS)[number];

/**
 * The desk: Rudy's terminal with the modules as squares right above it.
 * You talk to Rudy IN the terminal; the queue is a folded strip below it
 * that only opens when something is actually held. Modules never replace
 * the desk, they slide over it as sheets.
 */
export function HqDesk({ boss, bossStatus, agentCount, modules, active, needsCount, onModule, onNewSession, onHire }: {
  boss: Agent | null;
  bossStatus: BossStatus;
  agentCount: number;
  modules: Module[];
  active: CCTab | null;
  needsCount: number;
  onModule: (key: CCTab) => void;
  onNewSession: () => void;
  onHire: () => void;
}) {
  if (!boss) {
    return (
      <div className="aur-glass hq-desk">
        {agentCount === 0 && bossStatus === 'booting' ? (
          <div className="hq-empty">
            <div className="hq-empty-k">WAKING THE FLOOR</div>
            <div className="hq-empty-t">Rudy is clocking in.</div>
            <p className="hq-empty-p">His terminal lands here the moment he is seated.</p>
          </div>
        ) : agentCount === 0 ? (
          <div className="hq-empty">
            <div className="hq-empty-k">EMPTY FLOOR</div>
            <div className="hq-empty-t">Nobody is seated yet.</div>
            <p className="hq-empty-p">Hire your first agent and watch real output stream in here.</p>
            <button className="hq-hire" style={{ marginLeft: 0 }} onClick={onHire}>+ HIRE</button>
          </div>
        ) : (
          <div className="hq-empty">
            <div className="hq-empty-k">NO ONE AT THE DESK</div>
            <div className="hq-empty-t">Rudy is not seated.</div>
            <p className="hq-empty-p">The floor is running without him. Restart the app to bring him back to the desk.</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="aur-glass hq-desk">
      <DeskHead boss={boss} />
      <div className="hq-sq-row">
        {modules.map((m) => {
          const isNeeds = m.key === 'human';
          const on = active === m.key;
          return (
            <button
              key={m.key}
              className={`hq-sq${on ? ' on' : ''}${isNeeds && needsCount > 0 ? ' alert' : ''}${isNeeds && needsCount === 0 && !on ? ' dim' : ''}`}
              onClick={() => onModule(m.key)}
              title={isNeeds
                ? (needsCount > 0
                  ? `${needsCount} waiting on your answer`
                  : 'Nothing needs you right now')
                : m.label}
            >
              <Icon name={m.icon} />
              {m.label.toUpperCase()}
              {isNeeds && needsCount > 0 && <span className="hq-sq-n">{needsCount}</span>}
            </button>
          );
        })}
        <button
          className="hq-sq newsess"
          onClick={onNewSession}
          title="Open a fresh Claude Code session in your harness. Same home, clean context."
        >
          <Icon name="plus" />
          NEW SESSION
        </button>
      </div>
      <div className="hq-desk-body">
        <CommandCenterPanel
          agent={boss}
          terminalOnly
          hideHeader
          composerCompact
          composerCollapsible
        />
      </div>
    </div>
  );
}

function DeskHead({ boss }: { boss: Agent }) {
  const { paused, toggle } = useFloorDelivery(boss.id);
  const setIdeOpen = useStore((s) => s.setIdeOpen);
  return (
    <div className="hq-desk-head">
      <RudyFace character={boss.character} size={40} mood={boss.status === 'blocked' ? 'hot' : 'calm'} />
      <div style={{ minWidth: 0 }}>
        {/* Status rides the NAME line; the sub line is one quiet phrase. The old
            [badge] + text pair on one sub row read as two competing labels. */}
        <div className="hq-desk-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {boss.name.toUpperCase()}
          <PixelBadge status={boss.status} />
        </div>
        <div className="hq-desk-sub">
          <span>{boss.action && boss.action !== 'awaiting' ? boss.action : 'runs the floor'}</span>
        </div>
      </div>
      <div className="hq-desk-tools">
        <button
          className={`hq-pill ${paused ? 'held' : 'live'}`}
          onClick={() => { void toggle(); }}
          title={paused
            ? 'Queued messages are being held for every agent on the floor. Nothing is lost; click to resume delivery.'
            : 'Queued messages are delivered to every agent automatically. Click to hold the whole floor.'}
          aria-label={paused ? 'Resume automatic delivery for the whole floor' : 'Hold automatic delivery for the whole floor'}
        >
          <Icon name={paused ? 'pause' : 'play'} />
          {paused ? 'HELD' : 'AUTO'}
        </button>
        <button
          className="hq-pill"
          onClick={() => setIdeOpen(true, boss.id)}
          title="Open the IDE: browse and edit files in the selected agent's workspace, and see uncommitted changes as a diff."
          aria-label="Open the IDE"
        >
          <Icon name="code" />
          IDE
        </button>
      </div>
    </div>
  );
}
