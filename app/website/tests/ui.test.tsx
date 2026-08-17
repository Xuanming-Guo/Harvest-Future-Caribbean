import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { Badge } from "@/components/ui";
import { roleHome } from "@/lib/api";
import { compactId, formatPercent, titleCase } from "@/lib/format";
import { clearOnboardingStatus, readOnboardingStatus, roleTutorials, writeOnboardingStatus } from "@/lib/onboarding";

beforeEach(() => window.localStorage.clear());

describe("website presentation helpers", () => {
  it("formats contract statuses without changing their value", () => {
    render(<Badge>AWAITING_APPROVAL</Badge>);
    expect(screen.getByText("Awaiting Approval")).toBeInTheDocument();
  });

  it("formats common values", () => {
    expect(compactId("20202020-2020-4020-8020-202020202020")).toBe("20202020...");
    expect(formatPercent(0.7)).toBe("70%");
    expect(titleCase("MODEL_PREDICTED")).toBe("Model Predicted");
  });

  it("maps each participant role to its own workspace", () => {
    expect(roleHome("FARMER")).toBe("/farmer");
    expect(roleHome("BUYER")).toBe("/buyer");
    expect(roleHome("TRANSPORTER")).toBe("/transporter");
    expect(roleHome("COORDINATOR")).toBe("/coordinator");
  });

  it("stores the tutorial choice separately for each signed-in identity", () => {
    const farmer = { authSubject: "farmer-ana" };
    const buyer = { authSubject: "buyer-hotel" };

    expect(readOnboardingStatus(farmer)).toBeNull();
    writeOnboardingStatus(farmer, "skipped");
    writeOnboardingStatus(buyer, "completed");

    expect(readOnboardingStatus(farmer)).toBe("skipped");
    expect(readOnboardingStatus(buyer)).toBe("completed");
    clearOnboardingStatus(farmer);
    expect(readOnboardingStatus(farmer)).toBeNull();
    expect(readOnboardingStatus(buyer)).toBe("completed");
  });

  it("provides a focused tutorial for every product role", () => {
    expect(Object.keys(roleTutorials)).toEqual(["FARMER", "BUYER", "TRANSPORTER", "COORDINATOR"]);
    for (const tutorial of Object.values(roleTutorials)) {
      expect(tutorial.steps.length).toBeGreaterThanOrEqual(4);
      expect(tutorial.steps.every((step) => step.target.startsWith('[data-tour="'))).toBe(true);
    }
  });
});
