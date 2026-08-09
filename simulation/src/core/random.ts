/**
 * Seeded pseudo-randomness for the simulation.
 *
 * Reproducibility is an acceptance criterion for the simulation, not a nicety:
 * the paired benchmark is only meaningful if the baseline and Harvest runs face
 * an identical world. That rules out `Math.random()` anywhere in this package.
 *
 * The subtle failure this file exists to prevent is *stream coupling*. With one
 * shared generator, drawing one extra number for, say, a weather roll shifts
 * every later draw in every other subsystem, so an unrelated change silently
 * alters demand, yields and disruptions. Two runs meant to differ only by
 * policy would then differ everywhere, and the benchmark would measure noise.
 *
 * Each subsystem therefore takes a named stream, seeded from the run seed mixed
 * with the stream name. Streams are independent: adding, removing or reordering
 * draws inside one leaves the others bit-for-bit identical.
 */

/** A deterministic source of uniform numbers in [0, 1). */
export interface RandomStream {
  readonly name: string;
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [minInclusive, maxInclusive]. */
  int(minInclusive: number, maxInclusive: number): number;
  /** Uniform in [min, max). */
  float(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** Uniformly picks one element. Throws on an empty list rather than returning undefined. */
  pick<T>(items: readonly T[]): T;
  /**
   * Normal deviate via Box-Muller, clamped to +/- 4 sigma.
   *
   * The clamp keeps a synthetic yield or delay from taking an absurd tail value
   * that would read as a bug in a demo. It biases the extreme tails slightly,
   * which is an acceptable trade for a scenario generator.
   */
  normal(mean: number, standardDeviation: number): number;
}

/** FNV-1a. Small, dependency-free, and good enough to decorrelate stream names. */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    // The FNV prime, via shifts, because a plain multiply overflows to a float.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * mulberry32: a 32-bit generator with a full 2^32 period, chosen because it is
 * short enough to audit at a glance. A simulation needs reproducibility, not
 * cryptographic quality, and nothing here is security-relevant.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = state;
    drawn = Math.imul(drawn ^ (drawn >>> 15), drawn | 1);
    drawn ^= drawn + Math.imul(drawn ^ (drawn >>> 7), drawn | 61);
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
}

function createStream(name: string, seed: number): RandomStream {
  const next = mulberry32((seed ^ hashName(name)) >>> 0);

  const stream: RandomStream = {
    name,
    next,
    int: (minInclusive, maxInclusive) => {
      if (maxInclusive < minInclusive) {
        throw new RangeError(`Empty integer range [${minInclusive}, ${maxInclusive}] on stream '${name}'.`);
      }
      return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
    },
    float: (min, max) => min + next() * (max - min),
    chance: (probability) => next() < probability,
    pick: (items) => {
      if (items.length === 0) {
        throw new RangeError(`Cannot pick from an empty list on stream '${name}'.`);
      }
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    normal: (mean, standardDeviation) => {
      // Reject exact zero: Math.log(0) is -Infinity and would poison the run.
      let uniform = next();
      while (uniform === 0) uniform = next();
      const magnitude = Math.sqrt(-2 * Math.log(uniform));
      const angle = 2 * Math.PI * next();
      const deviate = magnitude * Math.cos(angle);
      const clamped = Math.max(-4, Math.min(4, deviate));
      return mean + clamped * standardDeviation;
    },
  };

  return stream;
}

/**
 * The set of independent streams belonging to one run.
 *
 * Streams are memoised, so asking for `'weather'` twice returns the same
 * generator and continues its sequence rather than restarting it.
 */
export class RandomSource {
  private readonly streams = new Map<string, RandomStream>();

  constructor(public readonly seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
      // Matches the contract bound on SimulationRunCreate.seed.
      throw new RangeError(`Seed must be an integer in [0, 4294967295], received ${seed}.`);
    }
  }

  stream(name: string): RandomStream {
    const existing = this.streams.get(name);
    if (existing) return existing;
    const created = createStream(name, this.seed);
    this.streams.set(name, created);
    return created;
  }
}
