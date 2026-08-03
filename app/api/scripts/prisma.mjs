import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const localDatabase =
  "postgresql://harvest:harvest-local-only@localhost:5432/harvest?schema=public";
const cli = fileURLToPath(new URL("../../../node_modules/prisma/build/index.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? localDatabase },
  stdio: "inherit",
});

process.exit(result.status ?? 1);
