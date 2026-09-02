import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Badge, Disclosure, MoreDetail } from "@/components/ui";
import { consumeDevelopmentPersona, currentActor, developmentPersonaFromHash, roleHome } from "@/lib/api";
import { compactId, formatPercent, titleCase } from "@/lib/format";
import { clearOnboardingStatus, readOnboardingStatus, roleTutorials, writeOnboardingStatus } from "@/lib/onboarding";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

describe("workspace disclosure", () => {
  const openSummary = () => screen.getByRole("button", { name: /Track collection/ });

  it("starts closed, names its panel, and opens on activation", () => {
    render(
      <Disclosure id="track-collection" title="Track collection" summary="2 collections planned">
        <p>A driver comes to your farm.</p>
      </Disclosure>,
    );
    const summary = openSummary();
    const panel = document.getElementById("track-collection-panel");

    // A real button, so Enter and Space already work without extra key handling.
    expect(summary.tagName).toBe("BUTTON");
    expect(summary).toHaveAttribute("type", "button");
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(summary).toHaveAttribute("aria-controls", "track-collection-panel");
    expect(panel).toHaveAttribute("aria-labelledby", "track-collection-summary");
    expect(panel).not.toBeVisible();
    expect(screen.getByText("2 collections planned")).toBeInTheDocument();

    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(screen.getByText("A driver comes to your farm.")).toBeVisible();

    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
  });

  it("renders a primary section open from the start", () => {
    render(
      <Disclosure id="track-collection" title="Track collection" summary="2 collections planned" primary defaultOpen>
        <p>A driver comes to your farm.</p>
      </Disclosure>,
    );
    expect(openSummary()).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector(".workspace-section-primary")).toBeInTheDocument();
  });

  it("opens itself when it becomes the recommended section, without closing a reader's choice", () => {
    const { rerender } = render(
      <Disclosure id="track-collection" title="Track collection" summary="2 collections planned">
        <p>A driver comes to your farm.</p>
      </Disclosure>,
    );
    expect(openSummary()).toHaveAttribute("aria-expanded", "false");

    rerender(
      <Disclosure id="track-collection" title="Track collection" summary="2 collections planned" defaultOpen>
        <p>A driver comes to your farm.</p>
      </Disclosure>,
    );
    expect(openSummary()).toHaveAttribute("aria-expanded", "true");

    rerender(
      <Disclosure id="track-collection" title="Track collection" summary="2 collections planned">
        <p>A driver comes to your farm.</p>
      </Disclosure>,
    );
    expect(openSummary()).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps advanced information behind a second toggle", () => {
    render(<MoreDetail id="collection" label="More detail: stops and distance"><div><span>Stops</span><b>3</b></div></MoreDetail>);
    const toggle = screen.getByRole("button", { name: /More detail: stops and distance/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("collection-detail")).not.toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Stops")).toBeVisible();
    expect(screen.getByRole("button", { name: /Hide detail/ })).toBeInTheDocument();
  });
});
