import { cleanup, render, screen } from "@testing-library/react";
import type { ControlRoomFrame } from "@harvest/simulation";
import { afterEach, describe, expect, it } from "vitest";

import MetricsPanel from "@/components/panels/MetricsPanel";

afterEach(cleanup);

const frame = {
  demands: [
    { status: "FULFILLED" },
    { status: "PARTIALLY_FULFILLED" },
    { status: "PENDING" },
    { status: "UNMET" },
  ],
  totals: {
    acceptedKg: 283.4,
    substitutedKg: 2033.2,
    demandsFullyMet: 1,
    demandsUnmet: 1,
  },
  operationsSnapshot: {
    activeListings: 8,
    openDemands: 8,
    ordersByStatus: { FULFILLED: 4, REQUESTED: 8 },
    orderOutcomes: { total: 12, fulfilled: 4, partiallyFulfilled: 0, unfulfilled: 5, pending: 3, causes: { NO_READY_SUPPLY: 3, MISSION_LATE: 2 } },
    deliveryAcceptedKg: 854,
    approvedCommitmentCount: 4,
    completedMissionCount: 4,
    paymentOverdueCount: 2,
    activeMissionIds: [],
    openExceptionIds: [],
  },
} as unknown as ControlRoomFrame;

describe("control-room outcome source", () => {
  it("renders Product API outcomes for Harvest", () => {
    render(<MetricsPanel frame={frame} policy="HARVEST" />);

    expect(screen.getByText("Harvest product outcomes")).toBeInTheDocument();
    expect(screen.getByText(/run-scoped Product API records/i)).toBeInTheDocument();
    expect(screen.getByText("854")).toBeInTheDocument();
    expect(screen.getByText("Total orders").nextElementSibling).toHaveTextContent("12");
    expect(screen.getByText("Fulfilled").nextElementSibling).toHaveTextContent("4");
    expect(screen.getByText("Completed delivery missions").nextElementSibling).toHaveTextContent("4");
    expect(screen.getByText("Overdue payments").nextElementSibling).toHaveTextContent("2");
    expect(screen.getByText(/does not move money/i)).toBeInTheDocument();
    expect(screen.queryByText("Substituted")).not.toBeInTheDocument();
    expect(screen.getByText("Why orders were missed")).toBeInTheDocument();
    expect(screen.getByText("No ready supply").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("Delivery missed the deadline").nextElementSibling).toHaveTextContent("2");
  });

  it("keeps baseline engine outcomes visibly separate", () => {
    render(<MetricsPanel frame={frame} policy="BASELINE" />);

    expect(screen.getByText("Fragmented baseline outcomes")).toBeInTheDocument();
    expect(screen.getByText(/physical simulation engine/i)).toBeInTheDocument();
    expect(screen.getByText("Substituted").nextElementSibling).toHaveTextContent("2,033");
    expect(screen.queryByText("Approved commitments")).not.toBeInTheDocument();
    expect(screen.queryByText("Overdue payments")).not.toBeInTheDocument();
  });
});
