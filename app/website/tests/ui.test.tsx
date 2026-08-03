import { render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui";
import { roleHome } from "@/lib/api";
import { compactId, formatPercent, titleCase } from "@/lib/format";

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
});
