/**
 * Static scan of the action-preview map.
 *
 * Two things silently rot otherwise, and neither shows up at runtime until a
 * judge is watching: a tool added to `ProductTools` that nobody maps, and a
 * `data-tour` target that was renamed or deleted on the page it points at. Both
 * degrade into a preview that opens a page and rings nothing, which reads as a
 * broken feature rather than as a gap. So the source of truth for each is read
 * from the source itself rather than restated here.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACTION_PREVIEW_TARGETS,
  PRODUCT_TOOL_NAMES,
  isUnmapped,
  previewActionIdFrom,
  previewTargetFor,
  withPreviewFlag,
} from "@/lib/action-preview";

/**
 * The jsdom environment serves modules over http, so `import.meta.url` is not a
 * file path here. Walking up from the working directory to the workspace root
 * is what stays true whichever way the suite is started.
 */
function findRepoRoot(): string {
  let directory = process.cwd();
  while (!existsSync(join(directory, "contracts", "openapi.yaml"))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Could not find the Harvest workspace root.");
    directory = parent;
  }
  return directory;
}

const repoRoot = findRepoRoot();
const websiteSource = join(repoRoot, "app", "website", "src");

/** Every tool `ProductTools` actually exposes, read out of the API itself. */
function productToolsInApi(): string[] {
  const source = readFileSync(join(repoRoot, "app", "api", "src", "simulation-agents.ts"), "utf8");
  const names = [...source.matchAll(/this\.mutate<[^>]*>\(\s*participant,\s*at,\s*"([a-z_]+)"/g)].map((match) => match[1]);
  return [...new Set(names)].sort();
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every `data-tour` value the website renders, as written in the markup. */
function renderedTourTargets(): Set<string> {
  const values = new Set<string>();
  for (const file of sourceFiles(websiteSource)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/data-tour="([a-z0-9-]+)"/g)) values.add(match[1]);
  }
  return values;
}

function selectorsOf(tool: keyof typeof ACTION_PREVIEW_TARGETS): string[] {
  const target = ACTION_PREVIEW_TARGETS[tool];
  if (isUnmapped(target)) return [];
  return [...target.targets, ...(target.entity?.targets ?? [])];
}

describe("action preview map", () => {
  it("covers every Product API tool a simulated participant can call", () => {
    expect([...PRODUCT_TOOL_NAMES].sort()).toEqual(productToolsInApi());
    for (const tool of PRODUCT_TOOL_NAMES) {
      const target = ACTION_PREVIEW_TARGETS[tool];
      expect(target, `${tool} has neither a mapping nor an explicit unmapped entry`).toBeDefined();
      if (isUnmapped(target)) expect(target.reason.length).toBeGreaterThan(0);
      else expect(target.targets.length).toBeGreaterThan(0);
    }
  });

  it("points only at controls the website still renders", () => {
    const rendered = renderedTourTargets();
    for (const tool of PRODUCT_TOOL_NAMES) {
      for (const selector of selectorsOf(tool)) {
        const name = /data-tour="([a-z0-9-]+)"/.exec(selector)?.[1];
        expect(name, `${tool} uses a selector this test cannot read: ${selector}`).toBeDefined();
        expect(rendered.has(name!), `${tool} points at data-tour="${name}", which no page renders`).toBe(true);
      }
    }
  });

  it("covers the four roles the issue names, each on a page that role may visit", () => {
    const roles = new Set(PRODUCT_TOOL_NAMES.flatMap((tool) => {
      const target = ACTION_PREVIEW_TARGETS[tool];
      return isUnmapped(target) ? [] : target.roles;
    }));
    expect([...roles].sort()).toEqual(["BUYER", "COORDINATOR", "FARMER", "TRANSPORTER"]);
    expect(selectorsOf("publish_listing").length).toBeGreaterThan(0);
    expect(selectorsOf("place_order").length).toBeGreaterThan(0);
    expect(selectorsOf("report_mission_progress").length).toBeGreaterThan(0);
    expect(selectorsOf("decide_approval").length).toBeGreaterThan(0);
  });

  it("treats an unknown tool as unmapped rather than guessing a page", () => {
    expect(previewTargetFor("some_tool_added_later")).toBeUndefined();
  });

  it("reads the preview flag and carries it across the website's own redirects", () => {
    expect(previewActionIdFrom("?preview=abc")).toBe("abc");
    expect(previewActionIdFrom("?preview=")).toBeNull();
    expect(previewActionIdFrom("?other=1")).toBeNull();
    expect(withPreviewFlag("/farmer", "?preview=abc")).toBe("/farmer?preview=abc");
    expect(withPreviewFlag("/farmer", "")).toBe("/farmer");
  });
});
