import { SpritePortrait } from '@/components/SpritePortrait';
import type { Agent } from '@/store/store';

/**
 * Rudy's face in a small gold ring. The ring breathes while he is around,
 * turns red and quickens when he needs you, and goes still when he is not
 * seated. Used at the desk head and beside the composer.
 */
export function RudyFace({ character, size = 40, mood = 'calm', title }: {
  character: Agent['character'];
  size?: number;
  mood?: 'calm' | 'hot' | 'still';
  title?: string;
}) {
  return (
    <div className={`hq-face-ring ${mood}`} style={{ width: size, height: size }} title={title}>
      {/* Portraits are 28px tall; size/34 keeps the WHOLE head inside the
          circle with headroom (size/26 made the sprite taller than the ring,
          so the top of the head clipped). */}
      <div className="hq-face" style={{ width: size, height: size }}>
        <SpritePortrait character={character} scale={size / 34} />
      </div>
    </div>
  );
}
