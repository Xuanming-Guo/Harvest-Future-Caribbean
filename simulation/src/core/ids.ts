/**
 * Deterministic identifiers.
 *
 * The contracts type most identifiers as `format: uuid`, so the simulation has
 * to emit something UUID-shaped. It cannot use `crypto.randomUUID()`: a rerun
 * of the same seed would produce different identifiers, and any artefact keyed
 * by them — event logs, benchmark records, snapshot digests — would stop being
 * comparable between the baseline and Harvest halves of a pair.
 *
 * These are therefore version-4 *shaped* strings drawn from a seeded stream.
 * They satisfy the contract's format and are unique within a run, but they are
 * not random and must never be treated as unguessable. Nothing in the
 * simulation relies on that; it holds no secrets and faces no untrusted input.
 */

import type { RandomStream } from './random.js';

const HEX_DIGITS = '0123456789abcdef';

/**
 * Mints UUID-shaped identifiers from one stream.
 *
 * Identifier generation gets its own stream so that adding an entity to a
 * scenario does not shift weather, demand or yield draws.
 */
export class IdFactory {
  constructor(private readonly stream: RandomStream) {}

  /** A version-4 shaped identifier with the correct version and variant nibbles. */
  next(): string {
    let out = '';
    for (let index = 0; index < 32; index += 1) {
      if (index === 12) {
        out += '4'; // Version 4.
      } else if (index === 16) {
        out += HEX_DIGITS[8 + this.stream.int(0, 3)]; // Variant: one of 8, 9, a, b.
      } else {
        out += HEX_DIGITS[this.stream.int(0, 15)];
      }
      if (index === 7 || index === 11 || index === 15 || index === 19) out += '-';
    }
    return out;
  }
}

/** Matches a canonical version-4 UUID. Exported so tests can assert the shape. */
export const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
