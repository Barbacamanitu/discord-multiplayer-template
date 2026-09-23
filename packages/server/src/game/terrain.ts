// Heightmap terrain for ScorchMatch. heights[i] is the y of the ground surface for the column starting at x = i * step
// (y grows downward, so smaller = taller). Everything below the surface is solid, so there are no overhangs:
// when an explosion removes dirt from a column, whatever was above the hole falls down to fill it.

export interface Terrain {
  heights: number[];
  step: number;
  // the surface can never be dug deeper than this
  bedrockY: number;
}

// Smooth random hills: a few octaves of 1D value noise, rescaled to [minY, maxY].
export function generateHeights(columns: number, minY: number, maxY: number, random = Math.random): number[] {
  const octaves = [
    // [number of hills across the stage, weight]
    { frequency: 2 + random() * 2, amplitude: 1 },
    { frequency: 6 + random() * 3, amplitude: 0.35 },
    { frequency: 16 + random() * 6, amplitude: 0.1 },
  ];

  const raw = new Array<number>(columns).fill(0);
  for (const { frequency, amplitude } of octaves) {
    const lattice = Array.from({ length: Math.ceil(frequency) + 2 }, () => random());
    for (let i = 0; i < columns; i++) {
      const pos = (i / columns) * frequency;
      const cell = Math.floor(pos);
      // cosine interpolation between lattice points keeps the hills smooth
      const t = (1 - Math.cos((pos - cell) * Math.PI)) / 2;
      raw[i] += amplitude * (lattice[cell] * (1 - t) + lattice[cell + 1] * t);
    }
  }

  const lo = Math.min(...raw);
  const hi = Math.max(...raw);
  return raw.map((v) => Math.round(minY + ((v - lo) / (hi - lo || 1)) * (maxY - minY)));
}

function columnRange(terrain: Terrain, left: number, right: number) {
  const first = Math.max(0, Math.floor(left / terrain.step));
  const last = Math.min(terrain.heights.length - 1, Math.floor(right / terrain.step));
  return { first, last };
}

// Level the ground under a tank's starting spot so it doesn't start on a slope.
export function flattenPad(terrain: Terrain, centerX: number, halfWidth: number) {
  const { first, last } = columnRange(terrain, centerX - halfWidth, centerX + halfWidth);
  let sum = 0;
  for (let i = first; i <= last; i++) {
    sum += terrain.heights[i];
  }
  const level = Math.round(sum / (last - first + 1));
  for (let i = first; i <= last; i++) {
    terrain.heights[i] = level;
  }
}

// Surface y at any x, interpolated between columns so shells hit smooth slopes rather than steps.
export function surfaceAt(terrain: Terrain, x: number): number {
  const { heights, step } = terrain;
  const pos = x / step;
  const i = Math.max(0, Math.min(heights.length - 1, Math.floor(pos)));
  const j = Math.min(heights.length - 1, i + 1);
  const t = Math.max(0, Math.min(1, pos - i));
  return heights[i] * (1 - t) + heights[j] * t;
}

// Where a tank comes to rest: on the highest ground anywhere under its footprint.
export function restingY(terrain: Terrain, centerX: number, halfWidth: number): number {
  const { first, last } = columnRange(terrain, centerX - halfWidth, centerX + halfWidth);
  let top = terrain.bedrockY;
  for (let i = first; i <= last; i++) {
    top = Math.min(top, terrain.heights[i]);
  }
  return top;
}

// Remove a circle of dirt. In each column, the part of the circle that overlaps solid ground is removed and the
// dirt above it drops down by that much. Returns the indices of columns that changed.
export function carveCrater(terrain: Terrain, cx: number, cy: number, radius: number): number[] {
  const changed: number[] = [];
  const { first, last } = columnRange(terrain, cx - radius, cx + radius);
  for (let i = first; i <= last; i++) {
    const x = i * terrain.step + terrain.step / 2;
    const dx = x - cx;
    if (Math.abs(dx) > radius) {
      continue;
    }
    const halfChord = Math.sqrt(radius * radius - dx * dx);
    const holeTop = cy - halfChord;
    const holeBottom = cy + halfChord;
    const surface = terrain.heights[i];
    const removed = Math.max(0, holeBottom - Math.max(holeTop, surface));
    if (removed > 0) {
      terrain.heights[i] = Math.min(terrain.bedrockY, Math.round(surface + removed));
      changed.push(i);
    }
  }
  return changed;
}
