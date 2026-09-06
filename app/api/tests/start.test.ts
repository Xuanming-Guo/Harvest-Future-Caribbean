import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it("the production start command serves health with workspace dependencies loaded", async () => {
  const apiDirectory = fileURLToPath(new URL("..", import.meta.url));
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  // Exercise the actual server command in a fresh Node process. Database
  // migrations are covered by CI setup; this catches entrypoint/loader failures
  // that importing buildServer through Vitest's own loader cannot expose.
  const command = manifest.scripts.start.split(" && ").at(-1) as string;
  const [executable, ...args] = command.split(" ");
  const child = spawn(executable === "node" ? process.execPath : executable!, args, {
    cwd: apiDirectory,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "0",
      PRODUCT_API_HOST: "127.0.0.1",
      ENABLE_DEV_AUTH: "false",
      MODEL_ADAPTER: "fixture",
      AGENT_LLM_PROVIDER: "",
      AGENT_LLM_MODEL: "",
      AGENT_LLM_BASE_URL: "",
      AGENT_LLM_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data.toString(); });
  child.stderr.on("data", (data) => { output += data.toString(); });

  try {
    const address = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`API startup timed out: ${output}`)), 15_000);
      const finish = (error?: Error, url?: string) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(url!);
      };
      child.once("error", (error) => finish(error));
      child.once("exit", (code) => finish(new Error(`API exited (${code}): ${output}`)));
      child.stdout.on("data", () => {
        const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) finish(undefined, match[1]);
      });
    });
    const response = await fetch(`${address}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", service: "harvest-product-api" });
  } finally {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
  }
}, 20_000);
