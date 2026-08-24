import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import IslandScopeControls from "@/components/IslandScopeControls";

afterEach(cleanup);

const islands = [
  { islandId: "saint-lucia", name: "Saint Lucia" },
  { islandId: "dominica", name: "Dominica" },
  { islandId: "barbados", name: "Barbados" },
];

describe("IslandScopeControls", () => {
  it("uses a custom scope listbox instead of exposing both choices as toolbar buttons", () => {
    render(<IslandScopeControls islands={islands} mode="SELECTED" selectedIslandIds={["saint-lucia"]} onModeChange={vi.fn()} onSelectedIslandIdsChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /selected islands/i }));

    expect(screen.getByRole("listbox", { name: "Island scope" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Whole Caribbean" })).toBeInTheDocument();
  });

  it("keeps a longer island catalogue inside a multi-select popup", () => {
    const onSelectedIslandIdsChange = vi.fn();
    render(<IslandScopeControls islands={islands} mode="SELECTED" selectedIslandIds={["saint-lucia"]} onModeChange={vi.fn()} onSelectedIslandIdsChange={onSelectedIslandIdsChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Saint Lucia" }));
    expect(screen.getByRole("listbox", { name: "Islands" })).toHaveAttribute("aria-multiselectable", "true");
    fireEvent.click(screen.getByRole("option", { name: "Dominica" }));
    expect(onSelectedIslandIdsChange).toHaveBeenCalledWith(["saint-lucia", "dominica"]);
  });
});
