/**
 * Client-bundle stub for the Node built-ins that recorded weather (#90) needs.
 *
 * `simulation/src/world/weather-reference.ts` reads its committed dataset with
 * node:fs, and `world/weather.ts` re-exports that module's evidence-type
 * constants, so the weather overlay's browser code pulls the loader into the
 * client graph even though nothing in this app calls it. The control room
 * replays runs the API has already saved; it never calls `runScenario`, so
 * `loadWeatherReference` is unreachable here.
 *
 * Every export therefore throws rather than returning a plausible empty value:
 * if this file is ever actually executed, the correct outcome is a loud error
 * naming the cause, not a silently empty weather record.
 */

const unavailable = (name: string) => (): never => {
  throw new Error(
    `${name} is a Node built-in and is not available in the control room's browser bundle. ` +
      "Recorded weather is loaded server-side when a run is created; see next.config.ts.",
  );
};

export const readFileSync = unavailable("readFileSync");
export const existsSync = unavailable("existsSync");
export const dirname = unavailable("dirname");
export const join = unavailable("join");
export const resolve = unavailable("resolve");
export const fileURLToPath = unavailable("fileURLToPath");

// `node:path` and `node:url` are imported by name above, but a default import
// must resolve too, so the stub carries one.
const nodeBuiltinStub = {};
export default nodeBuiltinStub;
