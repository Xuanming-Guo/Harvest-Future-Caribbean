"use client";

import { ArrowLeft, ArrowRight, Check, Compass, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SessionActor } from "@/lib/api";
import { roleHome } from "@/lib/api";
import {
  clearOnboardingStatus,
  readOnboardingStatus,
  roleTutorials,
  type TutorialStep,
  writeOnboardingStatus,
} from "@/lib/onboarding";

type GuideStage = "hidden" | "prompt" | "tour";

interface TargetBox {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

function matchesPath(step: TutorialStep, pathname: string) {
  if (step.path) return pathname === step.path;
  if (step.pathPrefix) return pathname.startsWith(step.pathPrefix);
  return true;
}

function targetHref(step: TutorialStep) {
  const target = document.querySelector(step.target);
  const link = target instanceof HTMLAnchorElement ? target : target?.querySelector("a");
  return link?.getAttribute("href") ?? null;
}

function nextFixedStep(steps: TutorialStep[], fromIndex: number) {
  for (let index = fromIndex; index < steps.length; index += 1) {
    if (steps[index]?.path) return index;
  }
  return steps.length;
}

export function OnboardingGuide({ actor, restartSignal }: { actor: SessionActor; restartSignal: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const tutorial = roleTutorials[actor.role];
  const [stage, setStage] = useState<GuideStage>("hidden");
  const [stepIndex, setStepIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<TargetBox | null>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const step = tutorial.steps[stepIndex];

  useEffect(() => {
    setStepIndex(0);
    setStage(readOnboardingStatus(actor) ? "hidden" : "prompt");
  }, [actor]);

  useEffect(() => {
    if (restartSignal === 0) return;
    clearOnboardingStatus(actor);
    setStepIndex(0);
    setTargetBox(null);
    setStage("tour");
    router.push(roleHome(actor.role));
  }, [actor, restartSignal, router]);

  useEffect(() => {
    if (stage === "hidden") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    primaryButton.current?.focus();
    return () => { document.body.style.overflow = previous; };
  }, [stage, stepIndex]);

  useEffect(() => {
    if (stage !== "tour" || !step) return;
    if (!matchesPath(step, pathname) && step.path) router.push(step.path);
  }, [pathname, router, stage, step]);

  const measureTarget = useCallback(() => {
    if (stage !== "tour" || !step || !matchesPath(step, pathname)) {
      setTargetBox(null);
      return;
    }
    const target = document.querySelector(step.target);
    if (!(target instanceof HTMLElement)) {
      setTargetBox(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setTargetBox({
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
  }, [pathname, stage, step]);

  useEffect(() => {
    if (stage !== "tour" || !step) return;
    let scrolled = false;
    const measure = () => {
      const target = document.querySelector(step.target);
      if (!scrolled && target instanceof HTMLElement && matchesPath(step, pathname)) {
        scrolled = true;
        target.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      }
      measureTarget();
    };
    measure();
    const interval = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measureTarget, pathname, stage, step]);

  const tooltipStyle = useMemo<CSSProperties>(() => {
    if (!targetBox) return {};
    const width = Math.min(390, targetBox.viewportWidth - 32);
    const left = Math.max(16, Math.min(targetBox.left, targetBox.viewportWidth - width - 16));
    const fitsBelow = targetBox.bottom + 260 < targetBox.viewportHeight;
    return {
      width,
      left,
      top: fitsBelow ? targetBox.bottom + 18 : Math.max(16, targetBox.top - 244),
    };
  }, [targetBox]);

  function skip() {
    writeOnboardingStatus(actor, "skipped");
    setStage("hidden");
  }

  function start() {
    setStepIndex(0);
    setTargetBox(null);
    setStage("tour");
    router.push(roleHome(actor.role));
  }

  function finish() {
    writeOnboardingStatus(actor, "completed");
    setStage("hidden");
  }

  function goTo(index: number) {
    const requested = tutorial.steps[index];
    if (!requested) {
      finish();
      return;
    }
    setTargetBox(null);
    setStepIndex(index);
    if (requested.path && pathname !== requested.path) router.push(requested.path);
  }

  function next() {
    if (!step) return;
    let nextIndex = stepIndex + 1;
    if (step.nextUsesTargetHref) {
      const href = targetHref(step);
      if (href) {
        setTargetBox(null);
        setStepIndex(nextIndex);
        router.push(href);
        return;
      }
      nextIndex = nextFixedStep(tutorial.steps, nextIndex);
    }
    goTo(nextIndex);
  }

  useEffect(() => {
    if (stage === "hidden") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") skip();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (stage === "hidden") return null;

  if (stage === "prompt") {
    return (
      <div className="onboarding-modal-layer">
        <section className="onboarding-prompt" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
          <span className="onboarding-prompt-icon"><Compass size={28} /></span>
          <p className="eyebrow">Welcome to Harvest</p>
          <h2 id="onboarding-title">Would you like a quick {actor.role.toLowerCase()} tutorial?</h2>
          <p>{tutorial.introduction}</p>
          <div className="onboarding-actions">
            <button className="button button-secondary" onClick={skip}>No, skip tutorial</button>
            <button ref={primaryButton} className="button" onClick={start}>Yes, show me around <ArrowRight size={17} /></button>
          </div>
          <small>You can restart it later from the Help card in the sidebar.</small>
        </section>
      </div>
    );
  }

  if (!step) return null;
  const isLast = stepIndex === tutorial.steps.length - 1;

  return (
    <div className={`tour-layer ${targetBox ? "tour-has-target" : ""}`} role="dialog" aria-modal="true" aria-labelledby="tour-step-title">
      <div className="tour-click-blocker" />
      {targetBox && (
        <div
          className="tour-highlight"
          data-tour-step={step.id}
          style={{
            top: Math.max(8, targetBox.top - 8),
            left: Math.max(8, targetBox.left - 8),
            width: Math.min(targetBox.viewportWidth - 16, targetBox.width + 16),
            height: targetBox.height + 16,
          }}
        />
      )}
      <section className={`tour-tooltip ${targetBox ? "" : "tour-tooltip-centred"}`} style={tooltipStyle}>
        <div className="tour-progress-row">
          <span>Step {stepIndex + 1} of {tutorial.steps.length}</span>
          <button className="icon-button" aria-label="Exit tutorial" onClick={skip}><X size={19} /></button>
        </div>
        <div className="tour-progress" aria-hidden="true"><span style={{ width: `${((stepIndex + 1) / tutorial.steps.length) * 100}%` }} /></div>
        <h2 id="tour-step-title">{step.title}</h2>
        <p>{step.description}</p>
        {!targetBox && <small className="tour-waiting">This area will be highlighted when its data is available.</small>}
        <div className="tour-tooltip-actions">
          <button className="button button-quiet" disabled={stepIndex === 0} onClick={() => goTo(stepIndex - 1)}><ArrowLeft size={16} />Back</button>
          <button ref={primaryButton} className="button" onClick={isLast ? finish : next}>
            {step.nextLabel ?? (isLast ? "Finish tutorial" : "Next")}
            {isLast ? <Check size={17} /> : <ArrowRight size={17} />}
          </button>
        </div>
      </section>
    </div>
  );
}
