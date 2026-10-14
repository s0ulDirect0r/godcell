/** One authored stretch, in the same coordinates for spawning, rendering and tests. */
export const HUNTING_GROVE = {
  name: 'The Lantern Grove',
  entrance: { x: 10300, y: 6400 },
  feeding: { x: 11650, y: 6400 },
  den: { x: 13900, y: 6400 },
  center: { x: 12200, y: 6400 },
  radius: 3000,
  trees: [
    [10400, 5600, 110, 700],
    [10500, 7200, 130, 850],
    [11400, 5450, 150, 1000],
    [11350, 7350, 160, 1100],
    [12300, 5700, 140, 900],
    [12300, 7100, 130, 850],
    [13300, 5000, 180, 1400],
    [14400, 5000, 180, 1400],
    [15000, 5700, 150, 1100],
    [15000, 7100, 150, 1100],
    [14300, 7800, 180, 1400],
    [13300, 7800, 180, 1400],
  ] as readonly (readonly [number, number, number, number])[],
};

export function inGrove(x: number, y: number, padding = 0): boolean {
  return (
    Math.abs(x - HUNTING_GROVE.center.x) < 2900 + padding && Math.abs(y - 6400) < 1700 + padding
  );
}

/** Earliest segment-circle contact. Sweeps fast projectiles rather than sampling their endpoint. */
export function segmentCircleHit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  radius: number
): number | null {
  const dx = bx - ax,
    dy = by - ay,
    ox = ax - cx,
    oy = ay - cy;
  const c = ox * ox + oy * oy - radius * radius;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (ox * dx + oy * dy),
    d = b * b - 4 * a * c;
  if (d < 0) return null;
  const t = (-b - Math.sqrt(d)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}
