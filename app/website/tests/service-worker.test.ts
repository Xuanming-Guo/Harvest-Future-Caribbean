import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync("public/sw.js", "utf8");
function worker(online = true) {
  const listeners = new Map<string, (event: unknown) => void>();
  const cached = { body: "old shell" };
  const fresh = { ok: true, body: "new shell", clone: () => fresh };
  const fetch = online ? vi.fn(async () => fresh) : vi.fn(async () => { throw new Error("offline"); });
  runInNewContext(source, { URL, fetch, self: { location: { origin: "https://harvest.test" }, addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler) }, caches: { match: vi.fn(async () => cached), open: vi.fn(async () => ({ put: vi.fn() })) } });
  async function request(path: string) {
    let result: unknown;
    listeners.get("fetch")!({ request: { method: "GET", url: `https://harvest.test${path}` }, respondWith: (response: unknown) => { result = response; } });
    return await result;
  }
  return { request, fetch, cached, fresh };
}
describe("offline shell freshness", () => {
  it("refreshes unversioned development chunks even when a cached copy exists", async () => {
    const { request, fresh, fetch } = worker();
    expect(await request("/_next/static/chunks/app/map/page.js")).toBe(fresh);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("retains the offline fallback for the same development chunk", async () => {
    const { request, cached } = worker(false);
    expect(await request("/_next/static/chunks/app/map/page.js")).toBe(cached);
  });
  it("continues to reuse content-hashed production chunks", async () => {
    const { request, cached, fetch } = worker();
    expect(await request("/_next/static/chunks/page-a1b2c3d4e5.js")).toBe(cached);
    expect(fetch).not.toHaveBeenCalled();
  });
});
