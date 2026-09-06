import { expect, it } from "vitest";
import { formatDate } from "@/lib/format";

it("preserves contract calendar dates while converting actual instants to island time", () => {
  expect(formatDate("2026-09-08", false)).toBe("8 Sept 2026");
  expect(formatDate("2026-09-08")).toBe("8 Sept 2026");
  expect(formatDate("2026-09-08T00:00:00Z", false)).toBe("7 Sept 2026");
});
