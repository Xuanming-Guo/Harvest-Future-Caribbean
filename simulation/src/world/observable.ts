/**
 * Projections out of the world, and the guard that keeps hidden truth in it.
 *
 * Two things live here:
 *
 *   1. `toObservableWorld`, which builds the allow-listed projection described
 *      by `ObservableWorld` in `contracts/openapi.yaml`. The contract calls it
 *      "observable world without hidden biological truth or future
 *      disruptions", and this is where that promise is kept.
 *   2. `worldDigest`, which reduces a world to a short string so a test can
 *      assert that two runs of one seed produced the same world, without
 *      comparing megabytes of state by eye.
 *
 * The projection is built by naming the fields to include, never by copying an
 * object and deleting fields. A future field added to `HiddenCropTruth` is then
 * absent from the projection by default rather than published by default.
 */

import { formatInstant, type SimulationInstant } from '../core/time.js';
import type { ActorRole, GeoPoint, World } from './types.js';

/** Mirrors `ObservableActor` in contracts/openapi.yaml. */
export interface ObservableActor {
  actorId: string;
  role: ActorRole;
  position: GeoPoint;
  activity: string;
}

/** Mirrors `ObservableRoute` in contracts/openapi.yaml. */
export interface ObservableRoute {
  missionId: string;
  status: 'PLANNED' | 'ACTIVE' | 'DELAYED' | 'COMPLETED' | 'CANCELLED';
  path: GeoPoint[];
}

/** Mirrors `ObservableDisruption` in contracts/openapi.yaml. */
export interface ObservableDisruptionView {
  eventId: string;
  type: 'WEATHER' | 'ROAD' | 'VEHICLE' | 'CROP' | 'OTHER';
  description: string;
  observedAt: string;
}

/** Mirrors `ObservableWorld` in contracts/openapi.yaml. */
export interface ObservableWorldView {
  runId: string;
  simulationTime: string;
  actors: ObservableActor[];
  routes: ObservableRoute[];
  disruptions: ObservableDisruptionView[];
}

/**
 * The contract's disruption enum has `OTHER` where the simulation has `DEMAND`.
 * Mapping rather than casting keeps a future enum change a compile error here
 * instead of an invalid payload at the boundary.
 */
function toContractDisruptionType(type: 'WEATHER' | 'ROAD' | 'VEHICLE' | 'CROP' | 'DEMAND'): ObservableDisruptionView['type'] {
  switch (type) {
    case 'WEATHER':
    case 'ROAD':
    case 'VEHICLE':
    case 'CROP':
      return type;
    case 'DEMAND':
      return 'OTHER';
  }
}

/**
 * Builds the control-room projection.
 *
 * Only missions that exist are described, and only disruptions already observed
 * at `simulationTime` appear. A disruption scheduled for tomorrow is in
 * `world.truth.disruptions` and must not show up here; publishing it would let
 * a policy plan around weather nobody has seen yet, which would quietly make
 * the Harvest arm of the benchmark clairvoyant rather than merely better
 * coordinated.
 */
export function toObservableWorld(runId: string, simulationTime: SimulationInstant, world: World): ObservableWorldView {
  const actors: ObservableActor[] = [];

  for (const farm of world.farms.values()) {
    actors.push({ actorId: farm.farmId, role: 'FARMER', position: farm.position, activity: 'TENDING' });
  }
  for (const buyer of world.buyers.values()) {
    actors.push({ actorId: buyer.buyerId, role: 'BUYER', position: buyer.position, activity: 'PURCHASING' });
  }
  for (const transporter of world.transporters.values()) {
    const activeMission = [...world.observed.missions.values()].find(
      (mission) => mission.transporterId === transporter.transporterId && mission.status === 'ACTIVE',
    );
    actors.push({
      actorId: transporter.transporterId,
      role: 'TRANSPORTER',
      // Position is the home depot unless a mission is running, in which case
      // the last path point stands in. A per-tick interpolated position is the
      // control room's job (issue #5), not the engine's.
      position: activeMission?.path.at(-1) ?? transporter.homePosition,
      activity: activeMission ? 'DELIVERING' : 'IDLE',
    });
  }

  const routes: ObservableRoute[] = [...world.observed.missions.values()]
    // The contract requires at least two points on a path.
    .filter((mission) => mission.path.length >= 2)
    .map((mission) => ({ missionId: mission.missionId, status: mission.status, path: mission.path }));

  const disruptions: ObservableDisruptionView[] = world.observed.disruptions
    .filter((disruption) => disruption.observedAt <= simulationTime)
    .map((disruption) => ({
      eventId: disruption.disruptionId,
      type: toContractDisruptionType(disruption.type),
      description: disruption.description,
      observedAt: formatInstant(disruption.observedAt),
    }));

  return { runId, simulationTime: formatInstant(simulationTime), actors, routes, disruptions };
}

/**
 * Fails loudly if a payload bound for a policy or an event carries hidden truth.
 *
 * The type split already prevents the ordinary mistake. This catches the
 * interesting one: a payload assembled dynamically, or widened through `any`,
 * that happens to carry a field named like a hidden value. It is a smoke alarm,
 * not a proof — it matches on field names, so a leak under a different name
 * passes. Reviewers still have to think.
 */
const FORBIDDEN_FIELD_NAMES = new Set([
  'potentialYieldKg',
  'readyAt',
  'qualityFraction',
  'dailySpoilageRate',
  'severity',
  'rainfallMmByDate',
  'truth',
  // A `WeatherModel` carries realised weather for days that have not happened,
  // which is future truth in the same sense a scheduled disruption is. The
  // model names its own store `hiddenRealisedWeather` precisely so that leaking
  // the whole object into a payload trips this alarm rather than passing
  // silently: the guard matches on field names, and a class instance's private
  // fields are ordinary own properties at runtime.
  'hiddenRealisedWeather',
]);

export function assertNoTruthLeak(value: unknown, context: string): void {
  const seen = new WeakSet<object>();

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_FIELD_NAMES.has(key)) {
        throw new Error(
          `Hidden simulation truth leaked into ${context}: field '${key}' at ${path}.${key}. ` +
            'Hidden truth must never reach a policy, an event payload, or the observable projection.',
        );
      }
      walk(child, `${path}.${key}`);
    }
  };

  walk(value, context);
}

/**
 * A stable digest of the whole world, hidden truth included.
 *
 * Determinism is only meaningfully tested by comparing the *hidden* state too.
 * Two runs could agree on every observable value while disagreeing on the truth
 * underneath, which would still break the paired benchmark.
 *
 * Map and Set iteration order follows insertion, which is itself deterministic
 * here, but keys are sorted anyway so that a harmless change in construction
 * order does not read as a determinism failure.
 */
export function worldDigest(world: World): string {
  const parts: string[] = [];

  const sortedCrops = [...world.truth.crops.values()].sort((a, b) => a.batchId.localeCompare(b.batchId));
  for (const crop of sortedCrops) {
    parts.push(
      [
        'crop',
        crop.batchId,
        crop.stage,
        crop.potentialYieldKg.toFixed(4),
        crop.readyAt,
        crop.qualityFraction.toFixed(6),
        crop.harvestedKg.toFixed(4),
        crop.lostKg.toFixed(4),
      ].join(':'),
    );
  }

  const sortedDemands = [...world.observed.demands.values()].sort((a, b) => a.demandId.localeCompare(b.demandId));
  for (const demand of sortedDemands) {
    parts.push(
      ['demand', demand.demandId, demand.status, demand.quantity.value.toFixed(4), demand.acceptedKg.toFixed(4), demand.substitutedKg.toFixed(4)].join(':'),
    );
  }

  const sortedCommitments = [...world.observed.commitments.values()].sort((a, b) => a.commitmentId.localeCompare(b.commitmentId));
  for (const commitment of sortedCommitments) {
    const allocations = [...commitment.allocations]
      .sort((a, b) => a.batchId.localeCompare(b.batchId))
      .map((allocation) => `${allocation.batchId}=${allocation.quantityKg.toFixed(4)}`)
      .join(',');
    parts.push(['commitment', commitment.commitmentId, commitment.status, allocations].join(':'));
  }

  const sortedMissions = [...world.observed.missions.values()].sort((a, b) => a.missionId.localeCompare(b.missionId));
  for (const mission of sortedMissions) {
    parts.push(['mission', mission.missionId, mission.status, mission.loadedKg.toFixed(4), String(mission.actualArrivalAt)].join(':'));
  }

  for (const disruption of [...world.observed.disruptions].sort((a, b) => a.disruptionId.localeCompare(b.disruptionId))) {
    parts.push(['disruption', disruption.disruptionId, disruption.type, disruption.observedAt].join(':'));
  }

  return fnv1a64(parts.join('|'));
}

/**
 * A 64-bit digest built from two independent 32-bit FNV-1a-style hashes.
 *
 * Everything is done with `Math.imul` and `>>> 0` so each step stays inside
 * 32-bit integer arithmetic. The obvious-looking alternative — carrying a
 * 64-bit accumulator in a plain `number` and multiplying by the 64-bit FNV
 * prime — is silently broken: the product reaches roughly 1e26, far past
 * `Number.MAX_SAFE_INTEGER`, so the low bits are rounded away and the hash
 * degenerates. It collapsed distinct worlds onto the same digest, which is the
 * one failure mode a determinism check must not have.
 *
 * Not cryptographic, and it does not need to be: this compares a run against
 * itself, so there is no adversary choosing inputs.
 */
function fnv1a64(input: string): string {
  let first = 0x811c9dc5;
  let second = 0xc2b2ae35;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    // A different multiplier keeps the halves from moving together, so the
    // pair carries closer to 64 bits of signal than 32 repeated twice.
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }

  // Final avalanche, so a one-character change spreads across the whole digest.
  first ^= first >>> 16;
  first = Math.imul(first, 0x7feb352d) >>> 0;
  first ^= first >>> 15;
  second ^= second >>> 13;
  second = Math.imul(second, 0x846ca68b) >>> 0;
  second ^= second >>> 16;

  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
