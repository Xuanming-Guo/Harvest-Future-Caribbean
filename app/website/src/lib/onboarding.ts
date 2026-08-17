import type { ProductRole, SessionActor } from "@/lib/api";

export type OnboardingStatus = "completed" | "skipped";

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  target: string;
  path?: string;
  pathPrefix?: string;
  nextLabel?: string;
  nextUsesTargetHref?: boolean;
}

export interface RoleTutorial {
  introduction: string;
  steps: TutorialStep[];
}

const STORAGE_PREFIX = "harvest.onboarding.v1";

function storageKey(actor: Pick<SessionActor, "authSubject">) {
  return `${STORAGE_PREFIX}:${actor.authSubject}`;
}

export function readOnboardingStatus(actor: Pick<SessionActor, "authSubject">): OnboardingStatus | null {
  if (typeof window === "undefined") return null;
  const status = window.localStorage.getItem(storageKey(actor));
  return status === "completed" || status === "skipped" ? status : null;
}

export function writeOnboardingStatus(actor: Pick<SessionActor, "authSubject">, status: OnboardingStatus) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(actor), status);
}

export function clearOnboardingStatus(actor: Pick<SessionActor, "authSubject">) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey(actor));
}

export const roleTutorials: Record<ProductRole, RoleTutorial> = {
  FARMER: {
    introduction: "See how to update a crop, understand safe supply, offer produce, and follow your orders.",
    steps: [
      {
        id: "farmer-home",
        title: "Your farm at a glance",
        description: "This page brings together your crops, safe-to-promise quantity, decisions, buyer opportunities, and upcoming pickups.",
        target: '[data-tour="farmer-home"]',
        path: "/farmer",
      },
      {
        id: "farmer-crops",
        title: "Open a crop",
        description: "Select a crop card whenever you need to report a field update, review its forecast, or offer produce to buyers.",
        target: '[data-tour="farmer-crop-link"]',
        path: "/farmer",
        nextLabel: "Open this crop",
        nextUsesTargetHref: true,
      },
      {
        id: "crop-outlook",
        title: "Understand the harvest outlook",
        description: "Harvest shows a range and confidence rather than one false promise. The low estimate helps determine what is safe to sell.",
        target: '[data-tour="crop-outlook"]',
        pathPrefix: "/crops/",
      },
      {
        id: "crop-update",
        title: "Share what you see",
        description: "Describe the field in plain language or complete the form. An assisted draft is never saved until you review and confirm it.",
        target: '[data-tour="crop-update"]',
        pathPrefix: "/crops/",
      },
      {
        id: "crop-listing",
        title: "Offer safe supply",
        description: "Use this form to publish no more than the available-to-promise quantity shown by Harvest.",
        target: '[data-tour="crop-listing"]',
        pathPrefix: "/crops/",
      },
      {
        id: "farmer-orders",
        title: "Follow commitments",
        description: "Your Orders page shows requests involving your farm, approval progress, delivery state, and any problem that needs attention.",
        target: '[data-tour="orders-workspace"]',
        path: "/orders",
        nextLabel: "Finish tutorial",
      },
    ],
  },
  BUYER: {
    introduction: "See how to find dependable local supply, record demand, place an order, and follow delivery.",
    steps: [
      {
        id: "buyer-home",
        title: "Your buying overview",
        description: "This page summarises open demand, active orders, deliveries, risks, and decisions waiting for you.",
        target: '[data-tour="buyer-home"]',
        path: "/buyer",
      },
      {
        id: "buyer-marketplace-link",
        title: "Start in the marketplace",
        description: "Choose Find local produce when you want to browse verified supply or record a future requirement.",
        target: '[data-tour="buyer-marketplace-link"]',
        path: "/buyer",
        nextLabel: "Open marketplace",
      },
      {
        id: "marketplace-supply",
        title: "Compare safe local supply",
        description: "Select one or more listing cards to inspect quantity, price, forecast evidence, and verification status.",
        target: '[data-tour="marketplace-supply"]',
        path: "/marketplace",
      },
      {
        id: "marketplace-requirement",
        title: "Record what you need",
        description: "Save demand for future matching, or select supply and place an order. Harvest validates the commitment before reserving anything.",
        target: '[data-tour="marketplace-requirement"]',
        path: "/marketplace",
      },
      {
        id: "buyer-orders",
        title: "Track every order",
        description: "Orders shows approval, allocation, mission, delivery, and final acceptance status in one place.",
        target: '[data-tour="orders-workspace"]',
        path: "/orders",
        nextLabel: "Finish tutorial",
      },
    ],
  },
  TRANSPORTER: {
    introduction: "See how to choose a vehicle, accept delivery work, follow stops, and report progress or delays.",
    steps: [
      {
        id: "transporter-home",
        title: "Your delivery workspace",
        description: "This page separates work available to accept from missions already assigned to you.",
        target: '[data-tour="transporter-home"]',
        path: "/transporter",
      },
      {
        id: "transporter-vehicle",
        title: "Choose the vehicle first",
        description: "Select an available vehicle before accepting a job so Harvest can check capacity and prevent conflicting work.",
        target: '[data-tour="transporter-vehicle"]',
        path: "/transporter",
      },
      {
        id: "transporter-available",
        title: "Accept suitable work",
        description: "Available jobs show the produce quantity, stop count, and deadline. Accepted work then moves into My jobs.",
        target: '[data-tour="transporter-available"]',
        path: "/transporter",
      },
      {
        id: "transporter-jobs",
        title: "Open a mission to report progress",
        description: "My jobs links to the ordered stops and the controls for arrival, pickup, delivery, and reporting a delay.",
        target: '[data-tour="transporter-jobs"]',
        path: "/transporter",
        nextLabel: "Finish tutorial",
      },
    ],
  },
  COORDINATOR: {
    introduction: "See how to verify evidence, review approvals, investigate exceptions, and keep orders moving.",
    steps: [
      {
        id: "coordinator-home",
        title: "Your coordination queue",
        description: "This page focuses on work that needs a person: approvals, verification, and active exceptions.",
        target: '[data-tour="coordinator-home"]',
        path: "/coordinator",
      },
      {
        id: "coordinator-approvals",
        title: "Review sensitive decisions",
        description: "Harvest can propose a commitment or recovery, but it waits here for an authorised person to approve or decline it.",
        target: '[data-tour="coordinator-approvals"]',
        path: "/coordinator",
      },
      {
        id: "coordinator-verification",
        title: "Check crop evidence",
        description: "Open verification work, inspect the related crop, and either verify the update or request changes.",
        target: '[data-tour="coordinator-verification"]',
        path: "/coordinator",
      },
      {
        id: "coordinator-exceptions",
        title: "Handle exceptions",
        description: "Delivery, crop, road, and supply problems appear here with their observable evidence and recovery status.",
        target: '[data-tour="coordinator-exceptions"]',
        path: "/coordinator",
      },
      {
        id: "coordinator-crops",
        title: "Open permitted crop evidence",
        description: "Farm verification links let you inspect the forecast, observation status, and safe supply for farms you are allowed to support.",
        target: '[data-tour="coordinator-crop-link"]',
        path: "/coordinator",
        nextLabel: "Open crop evidence",
        nextUsesTargetHref: true,
      },
      {
        id: "coordinator-crop-detail",
        title: "Review without changing farm data",
        description: "The coordinator view exposes evidence and verification status while keeping farmer editing controls unavailable.",
        target: '[data-tour="crop-outlook"]',
        pathPrefix: "/crops/",
      },
      {
        id: "coordinator-orders",
        title: "Follow shared commitments",
        description: "Use Orders to see allocations, approvals, delivery state, and exceptions across work you are permitted to coordinate.",
        target: '[data-tour="orders-workspace"]',
        path: "/orders",
        nextLabel: "Finish tutorial",
      },
    ],
  },
};
