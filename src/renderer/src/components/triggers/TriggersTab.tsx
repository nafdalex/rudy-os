import { useState } from 'react';
import { SchedulesSection } from './SchedulesSection';
import { ContextSection } from './ContextSection';
import { WebhooksSection } from './WebhooksSection';
import { OrgSection } from './OrgSection';
import { Muted, Scroll, TriggerCard } from './ui';

/**
 * TRIGGERS — every way the floor gets woken up without a human typing, in one
 * tab. Four types (src/shared/triggers.ts is the contract): schedules, context,
 * webhooks and organisation. Schedules is the oldest and used to BE this tab.
 *
 * This panel is a sidebar, so four flat forms would open as a wall. Each type is
 * a collapsed card carrying its name, a one-line "what this is", and a live
 * summary chip; schedules opens expanded because it is the incumbent and the
 * office calendar deep-links here. Inside a card, each row collapses the same
 * way, so nothing is more than two disclosures from legible.
 */
export function TriggersTab() {
  const [schedulesSummary, setSchedulesSummary] = useState('');
  const [contextSummary, setContextSummary] = useState('');
  const [webhooksSummary, setWebhooksSummary] = useState('');
  const [orgSummary, setOrgSummary] = useState('');

  return (
    <Scroll>
      <Muted>
        Everything that can start work without you typing. Each card below is one
        kind of trigger: WHEN its condition fires, THEN its prompt lands in an
        agent's terminal. You can also just ask Rudy in his terminal ("check the
        repo every night at 2"): he files the schedule himself and it appears
        under SCHEDULES with a BY RUDY chip for you to keep, edit, or switch off.
      </Muted>
      <div style={{ height: 8 }} />

      <TriggerCard
        title="SCHEDULES"
        blurb="WHEN the clock hits · THEN a prompt is sent. Rudy can file these too."
        summary={schedulesSummary}
        defaultOpen
      >
        <SchedulesSection onSummary={setSchedulesSummary} />
      </TriggerCard>

      <TriggerCard
        title="CONTEXT"
        blurb="WHEN a chat gets too full · THEN it is compacted so no tokens are wasted."
        summary={contextSummary}
      >
        <ContextSection onSummary={setContextSummary} />
      </TriggerCard>

      <TriggerCard
        title="WEBHOOKS"
        blurb="WHEN an outside system calls a URL · THEN its message lands on the floor."
        summary={webhooksSummary}
      >
        <WebhooksSection onSummary={setWebhooksSummary} />
      </TriggerCard>

      <TriggerCard
        title="ORGANISATION"
        blurb="WHEN a teammate's Rudy OS writes · THEN it reaches yours. Not live yet."
        summary={orgSummary}
      >
        <OrgSection onSummary={setOrgSummary} />
      </TriggerCard>
    </Scroll>
  );
}
