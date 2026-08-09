/**
 * Producing a replay timeline for the control room.
 *
 * The simulation runs IN THE BROWSER. That looks surprising for something the
 * architecture describes as a service, and it is a deliberate choice for this
 * issue:
 *
 *   - A twenty-one-day run costs a few milliseconds, so there is nothing to
 *     offload. A network round trip would be slower than the computation.
 *   - Scrubbing backwards is a hard requirement of the issue ("play, pause,
 *     speed, reset"). A live engine cannot run in reverse; a recorded timeline
 *     can be indexed in either direction.
 *   - Changing seed, policy or injected disruption becomes instantaneous, which
 *     is what makes the paired comparison demonstrable rather than described.
 *
 * The engine is pure TypeScript with no Node dependencies, so it runs unchanged
 * here. When the simulation service in `contracts/simulation/openapi.yaml` is
 * built, this module is the seam: `buildTimeline` becomes a fetch and nothing
 * above it changes.
 */

import { runScenario, type InjectedDisruption, type ReplayTimeline, type RunResult } from '@harvest/simulation';

export const DEFAULT_SCENARIO = 'saint-lucia-demo-v1';
export const DEFAULT_SEED = 8675309;

export type PolicyName = 'BASELINE' | 'HARVEST';

export interface TimelineRequest {
  scenarioId?: string;
  policy: PolicyName;
  seed: number;
  injectedDisruptions?: InjectedDisruption[];
}

export interface TimelineResult {
  timeline: ReplayTimeline;
  result: RunResult;
}

/**
 * Runs a scenario and returns its recorded timeline.
 *
 * Throws rather than returning a partial result: a control room showing a
 * half-built world is worse than one showing an error, because nothing on
 * screen would indicate which half was missing.
 */
export function buildTimeline(request: TimelineRequest): TimelineResult {
  const result = runScenario({
    scenarioId: request.scenarioId ?? DEFAULT_SCENARIO,
    policy: request.policy,
    seed: request.seed,
    captureFrames: true,
    injectedDisruptions: request.injectedDisruptions,
  });

  if (!result.timeline) {
    throw new Error('The engine returned no timeline despite frame capture being requested.');
  }

  return { timeline: result.timeline, result };
}

/** Human wording for an engine event type, for the feed and the inspector. */
const EVENT_LABELS: Record<string, string> = {
  WORLD_TICK: 'Daily world update',
  FARMER_OBSERVATION: 'Grower reported on a crop',
  BUYER_DEMAND: 'Buyer placed an order',
  PLAN_ALLOCATION: 'Supply matched to an order',
  APPROVAL_GATE: 'Commitment reached human approval',
  MISSION_DEPART: 'Vehicle collected and departed',
  MISSION_ARRIVE: 'Delivery arrived',
  DISRUPTION_START: 'Disruption became visible',
  DISRUPTION_END: 'Disruption cleared',
  DEMAND_DEADLINE: 'Order deadline passed',
};

export function describeEvent(eventType: string): string {
  return EVENT_LABELS[eventType] ?? eventType.toLowerCase().replace(/_/g, ' ');
}

/**
 * Whether an event is worth surfacing in the feed.
 *
 * `WORLD_TICK` fires daily and says nothing on its own; letting it through
 * would bury the events that matter under routine noise, which is exactly the
 * "understandable without reading raw logs" criterion failing.
 */
export function isNotableEvent(eventType: string): boolean {
  return eventType !== 'WORLD_TICK';
}

/** Events that should read as problems rather than progress. */
export function isAlertEvent(eventType: string): boolean {
  return eventType === 'DISRUPTION_START' || eventType === 'DEMAND_DEADLINE';
}
