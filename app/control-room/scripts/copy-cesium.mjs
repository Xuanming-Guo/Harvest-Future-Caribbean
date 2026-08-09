/**
 * Copies Cesium's static runtime assets into `public/cesium`.
 *
 * Cesium loads its web workers, shaders, imagery and widget CSS at runtime by
 * URL rather than through the bundler, so they have to sit on disk under a path
 * the browser can fetch. `window.CESIUM_BASE_URL` (set in the globe component)
 * points at the directory this script writes.
 *
 * The copy is a build artefact and is gitignored. `AGENTS.md` forbids
 * committing generated artefacts, and these are roughly 40 MB of them.
 *
 * Runs from predev, prebuild and pretest. It is a no-op when the destination is
 * already current, so it costs nothing on a warm repeat.
 */

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESTINATION = resolve(HERE, '..', 'public', 'cesium');

/** The four directories Cesium fetches at runtime. Nothing else is needed. */
const REQUIRED = ['Assets', 'ThirdParty', 'Widgets', 'Workers'];

function findCesiumBuildDirectory() {
  const require = createRequire(import.meta.url);
  try {
    // Resolve through the package rather than guessing at node_modules, so this
    // keeps working under npm workspace hoisting.
    const entry = require.resolve('cesium/package.json');
    return join(dirname(entry), 'Build', 'Cesium');
  } catch {
    return null;
  }
}

async function isUpToDate(source) {
  if (!existsSync(DESTINATION)) return false;

  for (const directory of REQUIRED) {
    if (!existsSync(join(DESTINATION, directory))) return false;
  }

  // A shallow check: if the source is newer than what was copied, redo it.
  // Comparing every file would cost more than the copy it is trying to avoid.
  try {
    const [sourceStat, destinationStat] = await Promise.all([
      stat(join(source, 'Workers')),
      stat(join(DESTINATION, 'Workers')),
    ]);
    if (sourceStat.mtimeMs > destinationStat.mtimeMs) return false;
    const copied = await readdir(join(DESTINATION, 'Workers'));
    return copied.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  const source = findCesiumBuildDirectory();

  if (!source || !existsSync(source)) {
    // Fail loudly. A silent skip here produces a blank globe at runtime with a
    // pile of 404s in the console, which is a far worse thing to debug.
    console.error(
      '[copy-cesium] Could not find Cesium build assets. Is the "cesium" dependency installed?\n' +
        `[copy-cesium] Looked in: ${source ?? '(package not resolvable)'}`,
    );
    process.exit(1);
  }

  if (await isUpToDate(source)) {
    console.log('[copy-cesium] Assets already current.');
    return;
  }

  console.log(`[copy-cesium] Copying Cesium runtime assets to ${DESTINATION}`);
  await rm(DESTINATION, { recursive: true, force: true });
  await mkdir(DESTINATION, { recursive: true });

  for (const directory of REQUIRED) {
    const from = join(source, directory);
    if (!existsSync(from)) {
      console.error(`[copy-cesium] Missing expected directory '${directory}' in the Cesium build.`);
      process.exit(1);
    }
    await cp(from, join(DESTINATION, directory), { recursive: true });
  }

  console.log('[copy-cesium] Done.');
}

await main();
