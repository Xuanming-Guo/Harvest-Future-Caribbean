/**
 * Headless scenario runner.
 *
 * Issue #4's acceptance criterion is that one scenario runs start to finish
 * without a UI, and that rerunning a seed reproduces the world. This is the
 * entry point that demonstrates both.
 *
 *   npm run sim -- --seed 8675309
 *   npm run sim -- --policy BASELINE --seed 42
 *   npm run sim -- --paired --seed 42        # both policies, same world
 *   npm run sim -- --paired --seeds 1,2,3    # several paired runs
 *   npm run sim -- --json                    # machine-readable output
 *
 * Wall-clock timing and file output live here rather than in the engine, which
 * is why this is the one source file permitted to touch `Date`.
 */

import { runScenario, type RunResult } from './engine.js';
import { saintLuciaDemoV1 } from './scenario/saint-lucia-demo-v1.js';

interface CliOptions {
  scenarioId: string;
  policy: 'BASELINE' | 'HARVEST';
  seeds: number[];
  paired: boolean;
  json: boolean;
  showDecisions: boolean;
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    scenarioId: saintLuciaDemoV1.scenarioId,
    policy: 'HARVEST',
    seeds: [8675309],
    paired: false,
    json: false,
    showDecisions: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = (): string => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} needs a value.`);
      index += 1;
      return value;
    };

    switch (argument) {
      case '--scenario':
        options.scenarioId = readValue();
        break;
      case '--policy': {
        const value = readValue().toUpperCase();
        if (value !== 'BASELINE' && value !== 'HARVEST') {
          throw new Error(`--policy must be BASELINE or HARVEST, received '${value}'.`);
        }
        options.policy = value;
        break;
      }
      case '--seed':
        options.seeds = [parseSeed(readValue())];
        break;
      case '--seeds':
        options.seeds = readValue().split(',').map((part) => parseSeed(part.trim()));
        break;
      case '--paired':
        options.paired = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--decisions':
        options.showDecisions = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument '${argument}'. Run with --help.`);
    }
  }

  return options;
}

function parseSeed(raw: string): number {
  const seed = Number(raw);
  if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) {
    throw new Error(`Seed '${raw}' must be an integer in [0, 4294967295].`);
  }
  return seed;
}

function printUsage(): void {
  process.stdout.write(
    [
      'Harvest simulation runner',
      '',
      'Options:',
      '  --scenario <id>     Scenario to run (default: saint-lucia-demo-v1)',
      '  --policy <name>     BASELINE or HARVEST (default: HARVEST)',
      '  --seed <n>          Single seed (default: 8675309)',
      '  --seeds <a,b,c>     Several seeds',
      '  --paired            Run BASELINE and HARVEST on the same world',
      '  --json              Emit JSON instead of a table',
      '  --decisions         Print the policy decision trace',
      '',
      'All output is SYNTHETIC simulated counterfactual evidence.',
      '',
    ].join('\n'),
  );
}

function formatMetricsLine(result: RunResult): string {
  const { metrics } = result;
  return [
    result.policy.padEnd(8),
    `seed=${String(result.seed).padEnd(9)}`,
    `fulfilled=${(metrics.fulfilmentRate * 100).toFixed(1).padStart(5)}%`,
    `localSupply=${(metrics.localProcurementRate * 100).toFixed(1).padStart(5)}%`,
    `waste=${metrics.wasteQuantity.value.toFixed(0).padStart(7)}kg`,
    `substituted=${metrics.totalSubstitutedKg.toFixed(0).padStart(7)}kg`,
    `demands=${String(metrics.demandsFullyMet).padStart(2)}/${String(
      metrics.demandsFullyMet + metrics.demandsPartiallyMet + metrics.demandsUnmet,
    ).padStart(2)}`,
    `events=${String(metrics.eventsProcessed).padStart(5)}`,
    `digest=${result.digest}`,
  ].join('  ');
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const startedAtMs = Date.now();

  const results: RunResult[] = [];
  for (const seed of options.seeds) {
    if (options.paired) {
      // The paired runs share a scenario and a seed, so they face an identical
      // world. Any difference in the metrics is attributable to the policy.
      results.push(runScenario({ scenarioId: options.scenarioId, policy: 'BASELINE', seed }));
      results.push(runScenario({ scenarioId: options.scenarioId, policy: 'HARVEST', seed }));
    } else {
      results.push(runScenario({ scenarioId: options.scenarioId, policy: options.policy, seed }));
    }
  }

  const elapsedMs = Date.now() - startedAtMs;

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ results, elapsedMs }, null, 2)}\n`);
    return;
  }

  process.stdout.write(`\nScenario: ${options.scenarioId}\n`);
  process.stdout.write(`${results[0]?.provenanceNote ?? ''}\n\n`);

  for (const result of results) {
    process.stdout.write(`${formatMetricsLine(result)}\n`);
  }

  if (options.paired) {
    process.stdout.write('\nPaired comparison (same world, policy is the only difference):\n');
    for (let index = 0; index + 1 < results.length; index += 2) {
      const baseline = results[index] as RunResult;
      const harvest = results[index + 1] as RunResult;
      const deltaFulfilment = (harvest.metrics.fulfilmentRate - baseline.metrics.fulfilmentRate) * 100;
      const deltaWaste = harvest.metrics.wasteQuantity.value - baseline.metrics.wasteQuantity.value;
      const deltaSubstituted = harvest.metrics.totalSubstitutedKg - baseline.metrics.totalSubstitutedKg;
      process.stdout.write(
        `  seed=${baseline.seed}  fulfilment ${deltaFulfilment >= 0 ? '+' : ''}${deltaFulfilment.toFixed(1)}pp  ` +
          `waste ${deltaWaste >= 0 ? '+' : ''}${deltaWaste.toFixed(0)}kg  ` +
          `substituted ${deltaSubstituted >= 0 ? '+' : ''}${deltaSubstituted.toFixed(0)}kg\n`,
      );
    }
  }

  if (options.showDecisions) {
    for (const result of results) {
      process.stdout.write(`\nDecision trace - ${result.policy} seed=${result.seed}\n`);
      for (const decision of result.decisions) {
        process.stdout.write(`  ${new Date(decision.at).toISOString()}  ${decision.kind.padEnd(28)} ${decision.summary}\n`);
      }
    }
  }

  process.stdout.write(`\n${results[0]?.evidenceLabel ?? ''}\n`);
  process.stdout.write(`Completed ${results.length} run(s) in ${elapsedMs} ms.\n\n`);
}

main();
