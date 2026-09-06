import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IslandMapPage from "@/app/map/page";
import { WORLD_ISLANDS, workspaceIsland } from "@/lib/caribbean-islands";

vi.mock("next/dynamic", () => ({ default: () => () => <div aria-label="Caribbean island map" /> }));
vi.mock("@/components/open-world-map", () => ({ OpenWorldMap: ({ world }: { world: { region: string; locations: unknown[] } }) => <div>Workspace places<span>{world.region} · {world.locations.length} locations</span></div> }));
vi.mock("@/components/providers", () => ({ useSession: () => ({ actor: { role: "BUYER" } }) }));
vi.mock("@tanstack/react-query", () => ({ useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[0] === "world-map" ? { region: "Saint Lucia", locations: [{ locationId: "farm-1" }] } : { items: [] } }) }));
afterEach(cleanup);

describe("Harvest World navigation", () => {
  it("keeps the original world on entry and offers all 28 islands", () => {
    render(<IslandMapPage />);
    expect(screen.getByText("Workspace places")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Caribbean" }));
    expect(screen.getByRole("heading", { name: "The Caribbean" })).toBeInTheDocument();
    expect(WORLD_ISLANDS).toHaveLength(28);
    expect(new Set(WORLD_ISLANDS.map(island => island.id)).size).toBe(28);
    const directory = screen.getByRole("complementary", { name: "Caribbean islands" });
    expect(within(directory).getAllByRole("button")).toHaveLength(29);
    fireEvent.change(screen.getByRole("textbox", { name: "Search islands" }), { target: { value: "jamaica" } });
    expect(within(directory).getByRole("button", { name: "Jamaica" })).toBeInTheDocument();
    expect(within(directory).queryByRole("button", { name: "Cuba" })).not.toBeInTheDocument();
  });
  it("does not put Saint Lucia's private workspace places on another island", () => {
    render(<IslandMapPage />);
    fireEvent.click(screen.getByRole("button", { name: "Caribbean" }));
    fireEvent.click(screen.getByRole("button", { name: "Jamaica" }));
    const card = screen.getByRole("region", { name: "Jamaica overview" });
    expect(within(card).getByText("No places yet")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Explore island" }));
    expect(screen.getByText("Jamaica · 0 locations")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Jamaica" })).toBeInTheDocument();
    expect(workspaceIsland("unknown region")).toBeUndefined();
    expect(workspaceIsland("Saint Lucia")?.id).toBe("saint-lucia");
  });
  it("opens the existing workspace and returns to the regional map", () => {
    render(<IslandMapPage />);
    fireEvent.click(screen.getByRole("button", { name: "Caribbean" }));
    fireEvent.click(screen.getByRole("button", { name: /My places/ }));
    expect(screen.getByText("Workspace places")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Caribbean" }));
    expect(screen.getByLabelText("Caribbean island map")).toBeInTheDocument();
    expect(screen.queryByText("Workspace places")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search islands" }), { target: { value: "zzzz" } });
    expect(screen.getByText("No matching islands")).toBeInTheDocument();
  });
});
