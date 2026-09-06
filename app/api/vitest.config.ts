import { defineConfig } from "vitest/config";

/**
 * API tests run one file at a time.
 *
 * Every test file in this package talks to the *same* PostgreSQL database —
 * there is one `DATABASE_URL`, the suite is seeded once by `pretest`, and the
 * tests assert against that shared seeded world. Vitest's default is to run
 * files in parallel worker threads, which means two files can be mutating and
 * asserting over the same rows at the same time: one file's `deleteMany`, or a
 * connected simulation run writing several hundred rows, lands in the middle of
 * another file's polling loop and it fails for reasons that have nothing to do
 * with the code under test.
 *
 * That was survivable while the suite was small and became a reliable source of
 * false failures once issue #40 added a second database-heavy file. Isolating
 * per file would mean a database per worker; serialising is the smaller change
 * and costs a couple of minutes of wall clock.
 */
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
