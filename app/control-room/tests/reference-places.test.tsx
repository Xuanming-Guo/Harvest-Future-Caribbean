import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  it("shows reference metadata without a disclaimer", () => {
    render(<Inspector scene={scene} frame={frame} selectedId={place.referencePlaceId} selectedAction={null} onClose={vi.fn()} />);
    expect(screen.queryByText("Reference location—not a Harvest participant or customer.")).not.toBeInTheDocument();
    expect(screen.getByText("Supermarket or public market")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "OpenStreetMap contributors" })).toHaveAttribute("href", place.sourceUrl);
    expect(screen.getByRole("link", { name: source.licenceName })).toHaveAttribute("href", source.licenceUrl);
  });

  it("shows the nearby reference without explanatory copy", () => {
    render(<Inspector scene={scene} frame={frame} selectedId="farm-1" selectedAction={null} onClose={vi.fn()} />);
    expect(screen.getByText("Nearby public reference")).toBeInTheDocument();
    expect(screen.queryByText(/This participant is synthetic/)).not.toBeInTheDocument();
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

  /*
   * ODbL requires the credit wherever the data is drawn, so the collapsed state
   * is the one worth testing hardest: the credit has to survive it, and the
   * licence apparatus has to still be in the document and one click away.
   */
  it("shows the OpenStreetMap credit while collapsed, with the detail behind a closed toggle", () => {
    render(<ReferenceAttribution sources={[source]} />);
    const toggle = screen.getByRole("button", { name: /Sources/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    // The whole default state is this one line: the credit ODbL requires, and
    // the way in. No URL, no retrieval date, no licence name.
    const line = toggle.closest("p");
    expect(line).toBeVisible();
    expect(line?.textContent).toBe("© OpenStreetMap contributors · Sources");

    // The detail is in the document, but not on the globe and not in the
    // accessibility tree.
    const licence = screen.getByText(source.licenceName);
    expect(licence).toBeInTheDocument();
    expect(licence).not.toBeVisible();
    expect(screen.queryByRole("link", { name: source.licenceName })).toBeNull();
  });

  it("expands the full source, licence and retrieval detail on click and closes on Escape", () => {
    render(
      <ReferenceAttribution
        sources={[source]}
        maritime={[{
          label: "Ferry and cargo links",
          publisher: "L'Express des Îles",
          sourceUrl: "https://www.express-des-iles.com/",
          licence: "Operator published timetable, reference use",
          retrievedAt: "2026-09-03",
        }]}

        recordedWeather
      />,
    );

    const toggle = screen.getByRole("button", { name: /Sources/ });
    // The collapsed line names the datasets in the scene and nothing else.
    expect(toggle.closest("p")?.textContent).toBe(
      "© OpenStreetMap contributors · recorded weather · ferry & FX references · Sources",
    );

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", screen.getByText(source.licenceName).closest("div")?.id);

    expect(screen.getByRole("link", { name: source.attribution })).toHaveAttribute("href", source.sourceUrl);
    expect(screen.getByRole("link", { name: source.licenceName })).toHaveAttribute("href", source.licenceUrl);
    expect(screen.getByText(/retrieved 2026-09-03/)).toBeVisible();
    expect(screen.queryByText(/Schedules, capacities, prices and outcomes are SYNTHETIC/)).not.toBeInTheDocument();
    expect(screen.queryByText(/days labelled PUBLIC_REFERENCE/)).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(source.licenceName)).not.toBeVisible();
    // The credit itself never goes away.
    expect(toggle.closest("p")).toHaveTextContent("© OpenStreetMap contributors");
  });

  it("closes when the click lands outside the attribution", () => {
    render(<ReferenceAttribution sources={[source]} />);
    const toggle = screen.getByRole("button", { name: /Sources/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(document.body);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
