import { useEffect, useState } from 'react';
import { useStore } from '@/store/store';

/**
 * ONE floor-wide auto-delivery switch. Toggling applies to every live agent,
 * boss included. Seeded from the boss's own control state: the floor is kept in
 * sync by this single control, so any agent's state reflects the floor's.
 *
 * Lifted out of the Command Center so the HQ desk header can carry the same
 * switch without mounting the panel's chrome.
 */
export function useFloorDelivery(bossId: string): { paused: boolean; toggle: () => Promise<void> } {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let alive = true;
    window.cth.controlSnapshot(bossId)
      .then((s) => { if (alive && s) setPaused(s.autoDeliveryPaused); })
      .catch(() => { /* none */ });
    return () => { alive = false; };
  }, [bossId]);

  const toggle = async () => {
    const next = !paused;
    setPaused(next);
    const all = useStore.getState().agents;
    await Promise.all(all.map((a) => window.cth.controlAutoDelivery(a.id, next).catch(() => null)));
  };

  return { paused, toggle };
}
