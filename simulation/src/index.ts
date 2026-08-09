/**
 * Public surface of `@harvest/simulation`.
 *
 * Kept explicit rather than re-exporting everything, so that what other areas
 * may depend on is a decision rather than an accident. Hidden-truth types are
 * exported for tests and for the engine's own use; nothing outside this package
 * should be reading them, and the observable projection is what the control
 * room (issue #5) and the benchmark (issue #11) should consume.
 */

export { SimulationEngine, runScenario } from './engine.js';
export type { EngineOptions, PolicyName, RunMetrics, RunResult, RunStatus } from './engine.js';

export { EventQueue, Priority } from './core/queue.js';
export type { ScheduledEvent } from './core/queue.js';
export { RandomSource } from './core/random.js';
export type { RandomStream } from './core/random.js';
export { IdFactory, UUID_V4_PATTERN } from './core/ids.js';
export * from './core/time.js';

export { SCENARIOS, requireScenario, saintLuciaDemoV1 } from './scenario/saint-lucia-demo-v1.js';
export type { Scenario, ScenarioContext } from './scenario/types.js';

export { baselinePolicy } from './policy/baseline.js';
export { harvestPolicy } from './policy/harvest.js';
export type { CoordinationPolicy, DecisionRecord, PolicyContext } from './policy/types.js';

export { assertNoTruthLeak, toObservableWorld, worldDigest } from './world/observable.js';
export type { ObservableWorldView } from './world/observable.js';
export type * from './world/types.js';
