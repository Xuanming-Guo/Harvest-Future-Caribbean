import type { ApiSchema } from "@harvest/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Badge } from "@/components/ui";
import { CropStandardCard } from "@/components/crop-standard-card";
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

  it("renders a sourced buyer checklist and reveals farmer guidance", () => {
    const standard = {
      standardId: "57575757-5757-4757-8757-575757575701",
      cropType: "CUCUMBER",
      publisherActorId: "a0000000-0000-4000-8000-000000000002",
      publisherName: "Bay Gardens Hotel",
      version: 2,
      status: "PUBLISHED",
      reviewedAt: "2026-09-03T12:00:00Z",
      geography: "Saint Lucia",
      source: { title: "Cucumber quality reference", url: "https://example.com/cucumber-quality", licence: "Reference licence", retrievedAt: "2026-09-03" },
      checklist: [{ key: "SIZE_AND_GRADE", requirement: "Keep each package uniform in size." }],
      images: [],
      guidance: [{ topic: "HARVEST_READINESS", text: "Harvest while fruit is firm and green.", source: { title: "Harvest guide", url: "https://example.com/cucumber-harvest", retrievedAt: "2026-09-03" } }],
    } satisfies ApiSchema<"CropStandard">;

    render(<CropStandardCard standard={standard} />);
    expect(screen.getByRole("heading", { name: "What buyers expect" })).toBeInTheDocument();
    expect(screen.getByText("Bay Gardens Hotel v2")).toBeInTheDocument();
    expect(screen.getByText("Keep each package uniform in size.")).toBeInTheDocument();
    expect(screen.queryByText("Harvest while fruit is firm and green.")).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Growing and harvest guidance" }));
    expect(screen.getByText("Harvest while fruit is firm and green.")).toBeVisible();
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
