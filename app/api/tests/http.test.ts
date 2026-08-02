import { describe, expect, it } from "vitest";

import { assertObjectBody, readLocation, readQuantity } from "../src/http.js";

describe("canonical request validation", () => {
  it("accepts explicit kilogram quantities", () => {
    expect(readQuantity({ value: 14, unit: "kg" })).toBe(14);
  });

  it("rejects bare or incompatible quantities", () => {
    expect(() => readQuantity(14)).toThrow("must be an object");
    expect(() => readQuantity({ value: 14, unit: "lb" })).toThrow("unit kg");
  });

  it("rejects unknown command fields", () => {
    expect(() => assertObjectBody({ cropType: "CUCUMBER", actorId: "injected" }, ["cropType"], ["cropType"]))
      .toThrow("Unknown field: actorId");
  });

  it("validates geographic bounds", () => {
    expect(readLocation({ latitude: 14.01, longitude: -60.98 })).toEqual({ latitude: 14.01, longitude: -60.98 });
    expect(() => readLocation({ latitude: 140, longitude: -60.98 })).toThrow("outside its valid range");
  });
});
