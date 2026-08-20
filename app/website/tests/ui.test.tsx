import { render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Badge } from "@/components/ui";
import { consumeDevelopmentPersona, currentActor, developmentPersonaFromHash, roleHome } from "@/lib/api";
import { compactId, formatPercent, titleCase } from "@/lib/format";
import { clearOnboardingStatus, readOnboardingStatus, roleTutorials, writeOnboardingStatus } from "@/lib/onboarding";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => vi.unstubAllGlobals());

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

  it("accepts only the four seeded website launcher personas", () => {
    expect(developmentPersonaFromHash("#harvest_demo_persona=farmer-ana")).toBe("farmer-ana");
    expect(developmentPersonaFromHash("#harvest_demo_persona=buyer-hotel")).toBe("buyer-hotel");
    expect(developmentPersonaFromHash("#harvest_demo_persona=transporter-daniel")).toBe("transporter-daniel");
    expect(developmentPersonaFromHash("#harvest_demo_persona=coordinator-maya")).toBe("coordinator-maya");
    expect(developmentPersonaFromHash("#harvest_demo_persona=operations-demo")).toBeNull();
    expect(developmentPersonaFromHash("#harvest_demo_persona=unknown-person")).toBeNull();
  });

  it("consumes a launcher persona, removes it from the URL and stores the normal session", async () => {
    const actor = {
      actorId: "actor-farmer-ana",
      authSubject: "farmer-ana",
      name: "Ana Joseph",
      role: "FARMER" as const,
      synthetic: true,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: "local-demo-token", actor }),
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/#harvest_demo_persona=farmer-ana");

    await expect(consumeDevelopmentPersona()).resolves.toEqual(actor);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/dev/session",
      expect.objectContaining({ body: JSON.stringify({ persona: "farmer-ana" }) }),
    );
    expect(window.location.hash).toBe("");
    expect(currentActor()).toEqual(actor);
  });

  it("removes an invalid launcher persona without calling development authentication", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("harvest.actor", JSON.stringify({ role: "BUYER" }));
    window.history.replaceState(null, "", "/#harvest_demo_persona=operations-demo");

    await expect(consumeDevelopmentPersona()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
    expect(currentActor()).toBeNull();
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
