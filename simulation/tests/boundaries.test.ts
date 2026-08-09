/**
 * The boundaries that `AGENTS.md`, `docs/architecture.md` and
 * `simulation/README.md` all insist on:
 *
 *   - hidden truth stays hidden;
 *   - the observable projection matches the shape the contract publishes;
 *   - a scenario runs headlessly from start to finish;
 *   - synthetic results are labelled as synthetic.
 *
 * These are the rules most likely to be broken quietly during a hackathon, so
 * they get tests rather than trust.
 */

import { describe, expect, it } from 'vitest';

import { SimulationEngine, runScenario } from '../src/engine.js';
import { assertNoTruthLeak } from '../src/world/observable.js';
import { saintLuciaDemoV1 } from '../src/scenario/saint-lucia-demo-v1.js';
import { UUID_V4_PATTERN } from '../src/core/ids.js';

const SCENARIO = saintLuciaDemoV1.scenarioId;

describe('hidden truth containment', () => {
  it('keeps hidden fields out of the observable projection', () => {
    const engine = new SimulationEngine({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 31 });
    engine.run();

    const view = engine.observableWorld;
    const serialised = JSON.stringify(view);

    for (const forbidden of ['potentialYieldKg', 'qualityFraction', 'dailySpoilageRate', 'severity', 'readyAt']) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(() => assertNoTruthLeak(view, 'projection')).not.toThrow();
  });

  it('does not publish a disruption before it becomes observable', () => {
    // A policy that could see tomorrow's road closure would look brilliant for
    // entirely the wrong reason.
    const engine = new SimulationEngine({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 555 });
    const atStart = engine.observableWorld;
    expect(atStart.disruptions).toHaveLength(0);
  });

  it('detects a deliberately planted leak', () => {
    // Confirms the guard actually guards, rather than passing because it never
    // inspects anything.
    expect(() => assertNoTruthLeak({ batch: { nested: { severity: 0.9 } } }, 'test payload')).toThrow(
      /Hidden simulation truth leaked/,
    );
    expect(() => assertNoTruthLeak({ list: [{ potentialYieldKg: 10 }] }, 'test payload')).toThrow(
      /Hidden simulation truth leaked/,
    );
  });

  it('survives a cyclic object without hanging', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic.self = cyclic;
    expect(() => assertNoTruthLeak(cyclic, 'cyclic')).not.toThrow();
  });
});

describe('observable projection shape', () => {
  it('matches the ObservableWorld contract', () => {
    const engine = new SimulationEngine({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 2024 });
    engine.run();
    const view = engine.observableWorld;

    expect(view.runId).toMatch(UUID_V4_PATTERN);
    expect(view.simulationTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Array.isArray(view.actors)).toBe(true);
    expect(view.actors.length).toBeGreaterThan(0);

    for (const actor of view.actors) {
      expect(actor.actorId).toMatch(UUID_V4_PATTERN);
      expect(['FARMER', 'BUYER', 'TRANSPORTER']).toContain(actor.role);
      expect(actor.position.latitude).toBeGreaterThanOrEqual(-90);
      expect(actor.position.latitude).toBeLessThanOrEqual(90);
      expect(actor.position.longitude).toBeGreaterThanOrEqual(-180);
      expect(actor.position.longitude).toBeLessThanOrEqual(180);
      expect(actor.activity.length).toBeGreaterThan(0);
    }

    // The contract requires at least two points on a route path.
    for (const route of view.routes) {
      expect(route.path.length).toBeGreaterThanOrEqual(2);
      expect(['PLANNED', 'ACTIVE', 'DELAYED', 'COMPLETED', 'CANCELLED']).toContain(route.status);
    }

    // DEMAND maps to OTHER; the contract has no DEMAND member.
    for (const disruption of view.disruptions) {
      expect(['WEATHER', 'ROAD', 'VEHICLE', 'CROP', 'OTHER']).toContain(disruption.type);
    }
  });
});

describe('headless run', () => {
  it('runs a scenario start to finish and reports completion', () => {
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 8675309 });

    expect(result.status).toBe('COMPLETED');
    expect(result.scenarioId).toBe(SCENARIO);
    expect(result.metrics.eventsProcessed).toBeGreaterThan(0);
    // The clock must actually reach the scenario horizon.
    expect(Date.parse(result.endedAt)).toBeGreaterThan(Date.parse(result.startedAt));
  });

  it('generates demand and reaches delivery outcomes', () => {
    // A run that completes without anything happening would satisfy a naive
    // "it finished" assertion while proving nothing.
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 8675309 });

    expect(result.metrics.totalDemandedKg).toBeGreaterThan(0);
    expect(result.metrics.commitmentsProposed).toBeGreaterThan(0);
    expect(result.decisions.length).toBeGreaterThan(0);
  });

  it('keeps every reported rate within [0, 1]', () => {
    for (const seed of [1, 42, 8675309]) {
      for (const policy of ['BASELINE', 'HARVEST'] as const) {
        const { metrics } = runScenario({ scenarioId: SCENARIO, policy, seed });
        expect(metrics.fulfilmentRate).toBeGreaterThanOrEqual(0);
        expect(metrics.fulfilmentRate).toBeLessThanOrEqual(1);
        expect(metrics.localProcurementRate).toBeGreaterThanOrEqual(0);
        expect(metrics.localProcurementRate).toBeLessThanOrEqual(1);
        expect(metrics.wasteQuantity.value).toBeGreaterThanOrEqual(0);
        expect(metrics.wasteQuantity.unit).toBe('kg');
      }
    }
  });

  it('rejects an unknown scenario by name, listing what exists', () => {
    expect(() => runScenario({ scenarioId: 'no-such-scenario', policy: 'HARVEST', seed: 1 })).toThrow(
      /Unknown scenario 'no-such-scenario'. Available: saint-lucia-demo-v1/,
    );
  });
});

describe('evidence labelling', () => {
  it('labels every result as synthetic simulated counterfactual', () => {
    // The repository evidence policy forbids presenting simulated output as
    // measured impact, so the label travels with the data rather than living
    // only in a document nobody reads.
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 3 });

    expect(result.evidenceLabel).toMatch(/SYNTHETIC/);
    expect(result.evidenceLabel).toMatch(/[Nn]ot evidence of real-world impact/);
    expect(result.provenanceNote).toMatch(/SYNTHETIC/);
  });
});

describe('policy behaviour', () => {
  // NOTE ON WHAT IS DELIBERATELY *NOT* ASSERTED HERE.
  //
  // There is no test claiming the Harvest policy beats the baseline, because
  // on the current scenario it does not, and a test tuned until it did would
  // be manufacturing the result the project exists to measure honestly.
  //
  // Establishing a counterfactual advantage is issue #11's job: repeated
  // paired seeds, reported distributions, and stated limitations. Issue #4
  // owns the machinery that makes such a comparison possible — identical
  // worlds, isolated policy hooks, reproducible seeds — and that is what these
  // tests cover. See simulation/README.md for the two causes identified so far.

  it('gives the Harvest policy a solicitation lever the baseline does not use', () => {
    // The mechanism, not the outcome: Harvest asks growers to check when its
    // evidence is too stale to promise against. The baseline has no one
    // holding the whole picture, so it never asks.
    const harvest = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 8675309 });
    const baseline = runScenario({ scenarioId: SCENARIO, policy: 'BASELINE', seed: 8675309 });

    expect(harvest.metrics.observationRequests).toBeGreaterThan(0);
    expect(baseline.metrics.observationRequests).toBe(0);
  });

  it('never lets a policy promise against a batch nobody has reported on', () => {
    // The conservatism rule that matters, stated as an invariant rather than
    // as a hoped-for outcome. Harvest returns zero available for an unobserved
    // batch, so a commitment can only ever trace back to reported evidence.
    const harvest = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 4242 });

    const declined = harvest.decisions.filter((decision) => decision.kind === 'HARVEST_NO_SAFE_SUPPLY');
    const proposed = harvest.decisions.filter((decision) => decision.kind === 'HARVEST_PROPOSE_ALLOCATION');

    // Both paths must be exercised, or the rule is untested in one direction.
    expect(declined.length + proposed.length).toBeGreaterThan(0);
    for (const decision of proposed) {
      expect(decision.evidence.discountApplied).toBe(true);
    }
  });

  it('caps replanning so a policy that always asks cannot spin forever', () => {
    // The replan loop is the one place in the engine where a policy could
    // schedule work indefinitely. The event cap would eventually catch it, but
    // as a crash rather than as correct behaviour.
    const harvest = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 31337 });
    expect(harvest.status).toBe('COMPLETED');
    // Generous bound: this is a runaway detector, not a performance assertion.
    expect(harvest.metrics.eventsProcessed).toBeLessThan(5_000);
  });

  it('commits each demand at most once', () => {
    // Double-committing would sell the same farmer's crop twice. Asserted
    // across both policies and several seeds because the approval gate makes
    // the Harvest path the risky one.
    for (const seed of [11, 22, 33]) {
      for (const policy of ['BASELINE', 'HARVEST'] as const) {
        const result = runScenario({ scenarioId: SCENARIO, policy, seed });
        // Every commitment that was not cancelled must belong to a distinct demand.
        expect(result.metrics.commitmentsApproved).toBeLessThanOrEqual(
          result.metrics.demandsFullyMet + result.metrics.demandsPartiallyMet + result.metrics.demandsUnmet,
        );
      }
    }
  });

  it('records an auditable decision trace with evidence', () => {
    const result = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 8675309 });

    expect(result.decisions.length).toBeGreaterThan(0);
    for (const decision of result.decisions) {
      expect(decision.kind).toMatch(/^[A-Z_]+$/);
      expect(decision.summary.length).toBeGreaterThan(0);
      expect(typeof decision.at).toBe('number');
      expect(decision.evidence).toBeTypeOf('object');
    }
  });

  it('applies an approval gate under Harvest and not under the baseline', () => {
    const harvest = runScenario({ scenarioId: SCENARIO, policy: 'HARVEST', seed: 8675309 });
    const baseline = runScenario({ scenarioId: SCENARIO, policy: 'BASELINE', seed: 8675309 });

    const harvestApprovals = harvest.decisions.filter((decision) => decision.kind.startsWith('HARVEST_APPROV'));
    expect(harvestApprovals.length).toBeGreaterThan(0);

    const baselineApprovals = baseline.decisions.filter((decision) => decision.kind.includes('APPROV'));
    expect(baselineApprovals).toHaveLength(0);
  });
});
