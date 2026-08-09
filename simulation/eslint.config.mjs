import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      // The engine must stay reproducible: a single Math.random() or Date.now()
      // anywhere in this package silently breaks the seeded-rerun guarantee
      // that issue #4 turns on, and it would do so without failing a test that
      // only checks one run against itself.
      "no-restricted-globals": ["error", { "name": "Date", "message": "Use simulation time from the engine clock, never wall-clock time." }],
      "no-restricted-properties": [
        "error",
        { "object": "Math", "property": "random", "message": "Use a seeded RandomStream from RandomSource instead." },
        { "object": "Date", "property": "now", "message": "Use simulation time from the engine clock instead." }
      ]
    }
  },
  {
    // time.ts is the one place allowed to touch Date, because converting
    // between epoch milliseconds and ISO strings is precisely its job.
    files: ["src/core/time.ts"],
    rules: { "no-restricted-globals": "off" }
  },
  {
    // The runner reports wall-clock duration and writes output files, which is
    // presentation rather than simulation state.
    files: ["src/run.ts"],
    rules: { "no-restricted-globals": "off", "no-restricted-properties": "off" }
  },
  {
    // Tests may parse the ISO strings the engine emits in order to assert on
    // them. They are checking the engine's output, not making decisions inside
    // it, so the reproducibility argument does not apply.
    files: ["tests/**/*.ts"],
    rules: { "no-restricted-globals": "off" }
  },
  { ignores: ["dist/**"] }
);
