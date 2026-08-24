import { cleanup, render, screen } from "@testing-library/react";
import type { ControlRoomFrame, ControlRoomScene, ReferenceDataSource, ReferencePlace } from "@harvest/simulation";
import { afterEach, describe, expect, it, vi } from "vitest";

import Inspector from "@/components/panels/Inspector";
import Legend from "@/components/panels/Legend";
import ReferenceAttribution from "@/components/panels/ReferenceAttribution";

afterEach(cleanup);

const source: ReferenceDataSource = {
  sourceId: "openstreetmap-v1",
  title: "OpenStreetMap Caribbean reference places snapshot",
  publisher: "OpenStreetMap contributors",
  sourceUrl: "https://www.openstreetmap.org/",
  licenceName: "Open Data Commons Open Database License 1.0",
  licenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution: "© OpenStreetMap contributors",
  retrievedAt: "2026-08-24",
  revision: "snapshot",
  limitations: ["Reference only."],
};

const place: ReferencePlace = {
  referencePlaceId: "osm-node-1",
  islandId: "saint-lucia",
  name: "Public Market",
  category: "SUPERMARKET_MARKET",
  position: { latitude: 14, longitude: -61 },
  sourceId: source.sourceId,
  sourceFeatureId: "node/1",
  sourceUrl: "https://www.openstreetmap.org/node/1",
  sourceRevision: "nominatim-place-1@2026-08-24",
  retrievedAt: "2026-08-24",
  evidenceType: "PUBLIC_REFERENCE_POINT",
  warnings: ["No endorsement is implied."],
};

const scene = {
  farms: [{ farmId: "farm-1", islandId: "saint-lucia", name: "Saint Lucia synthetic smallholding 1", position: place.position, referencePlaceId: place.referencePlaceId }],
  buyers: [], transporters: [], roads: [], participants: [],
  referencePlaces: [place], referenceDataSources: [source],
} as unknown as ControlRoomScene;
const frame = { batches: [], demands: [], missions: [], disruptions: [] } as unknown as ControlRoomFrame;

describe("reference-place presentation", () => {
  it("shows provenance, licence and the non-participant disclaimer", () => {
    render(<Inspector scene={scene} frame={frame} selectedId={place.referencePlaceId} selectedAction={null} onClose={vi.fn()} />);
    expect(screen.getByText("Reference location—not a Harvest participant or customer.")).toBeInTheDocument();
    expect(screen.getByText("Supermarket or public market")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OpenStreetMap contributors" })).toHaveAttribute("href", place.sourceUrl);
    expect(screen.getByRole("link", { name: source.licenceName })).toHaveAttribute("href", source.licenceUrl);
  });

  it("keeps the actor synthetic while showing its nearby reference", () => {
    render(<Inspector scene={scene} frame={frame} selectedId="farm-1" selectedAction={null} onClose={vi.fn()} />);
    expect(screen.getByText("Nearby public reference")).toBeInTheDocument();
    expect(screen.getByText(/This participant is synthetic/)).toBeInTheDocument();
  });

  it("renders persistent attribution and all reference categories in the key", () => {
    render(<><ReferenceAttribution sources={[source]} /><Legend /></>);
    expect(screen.getByLabelText("Reference place attribution")).toBeInTheDocument();
    expect(screen.getByText("Reference agriculture")).toBeInTheDocument();
    expect(screen.getByText("Reference hotel")).toBeInTheDocument();
    expect(screen.getByText("Reference restaurant")).toBeInTheDocument();
    expect(screen.getByText("Reference market")).toBeInTheDocument();
    expect(screen.getByText("Reference port")).toBeInTheDocument();
  });
});
