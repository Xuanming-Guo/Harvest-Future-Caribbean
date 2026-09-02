import type { ApiSchema } from "@harvest/shared";
import Link from "next/link";

import { titleCase } from "@/lib/format";

type CropBatch = ApiSchema<"CropBatch">;
type MarketOpportunity = ApiSchema<"MarketOpportunity">;
type DeliveryMission = ApiSchema<"DeliveryMission">;

const VIEW_W = 800;
const VIEW_H = 480;
const TILE_BOX = 132;
const SCALE_MIN = 0.68;
const SCALE_MAX = 1.3;
const QUANTITY_CAP = 260;

function plotScale(value: number) {
  const clamped = Math.max(0, Math.min(QUANTITY_CAP, value));
  return SCALE_MIN + (SCALE_MAX - SCALE_MIN) * (clamped / QUANTITY_CAP);
}

function plotPosition(index: number, total: number) {
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(total))));
  const rows = Math.max(1, Math.ceil(total / cols));
  const col = index % cols;
  const row = Math.floor(index / cols);
  const centerCol = (cols - 1) / 2;
  const centerRow = (rows - 1) / 2;
  const tileW = 148;
  const tileH = 92;
  const x = VIEW_W / 2 + (col - centerCol - (row - centerRow)) * (tileW / 2);
  const y = 176 + (col - centerCol + (row - centerRow)) * (tileH / 2);
  return { x, y };
}

function accessibleName(batch: CropBatch) {
  const status = batch.status.toLowerCase().replaceAll("_", " ");
  return `${titleCase(batch.cropType)} batch, ${status}, ${batch.availableToPromise.value} kg available`;
}

/**
 * A stylised, original 2D isometric view of the signed-in farmer's plots. Each
 * plot is a crop batch: its footprint scales with what is currently safe to
 * promise, its ground cover reflects the batch status, and an amber marker
 * appears when a buyer is currently asking for that crop. Purely presentational;
 * all data comes from the caller.
 */
export function FarmMap({
  batches,
  opportunities = [],
  missions = [],
}: {
  batches: CropBatch[];
  opportunities?: MarketOpportunity[];
  missions?: DeliveryMission[];
}) {
  const opportunityCropTypes = new Set(opportunities.map((item) => item.cropType.toLowerCase()));
  const hasActiveMission = missions.some((mission) => mission.status !== "DELIVERED" && mission.status !== "CANCELLED");

  return (
    <div className="farm-map">
      <svg
        className="farm-map-field"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="var(--cream)" />
        <polygon points="30,58 770,58 770,304 30,304" fill="var(--mint)" opacity="0.35" />
        <polygon points="0,352 800,296 800,412 0,468" fill="var(--amber)" opacity="0.4" />
        <line x1="8" y1="410" x2="792" y2="352" stroke="var(--cream)" strokeWidth="4" strokeDasharray="16 12" opacity="0.85" />

        <g className="farm-market">
          <rect x="46" y="150" width="72" height="60" rx="4" fill="var(--card)" stroke="var(--forest)" strokeWidth="2" />
          <polygon points="40,150 82,110 124,150" fill="var(--forest)" />
          <rect x="70" y="176" width="20" height="34" fill="var(--forest-dark)" />
          <circle cx="102" cy="168" r="5" fill="var(--blue)" />
        </g>

        {hasActiveMission && (
          <g className="farm-truck" data-testid="farm-truck">
            <rect x="560" y="368" width="54" height="26" rx="4" fill="var(--blue)" />
            <rect x="602" y="356" width="26" height="26" rx="4" fill="var(--forest-dark)" />
            <circle cx="576" cy="398" r="8" fill="var(--ink)" />
            <circle cx="614" cy="398" r="8" fill="var(--ink)" />
          </g>
        )}
      </svg>

      <div className="farm-map-plots">
        {batches.map((batch, index) => {
          const { x, y } = plotPosition(index, batches.length);
          const scale = plotScale(batch.availableToPromise.value);
          const boxSize = TILE_BOX * scale;
          const hasOpportunity = opportunityCropTypes.has(batch.cropType.toLowerCase());
          const statusClass = batch.status.toLowerCase().replaceAll("_", "-");

          return (
            <Link
              key={batch.cropBatchId}
              href={`/crops/${batch.cropBatchId}`}
              className={`farm-plot farm-plot-${statusClass}`}
              aria-label={accessibleName(batch)}
              style={{
                left: `${(x / VIEW_W) * 100}%`,
                top: `${(y / VIEW_H) * 100}%`,
                width: `${(boxSize / VIEW_W) * 100}%`,
                height: `${((boxSize * 0.72) / VIEW_H) * 100}%`,
              }}
            >
              <svg viewBox="0 0 100 70" aria-hidden="true" focusable="false">
                <polygon className="farm-plot-shape" points="50,4 96,35 50,66 4,35" />
                {batch.status === "GROWING" && (
                  <g className="farm-plot-sprouts">
                    <line x1="38" y1="40" x2="38" y2="26" />
                    <line x1="50" y1="44" x2="50" y2="24" />
                    <line x1="62" y1="40" x2="62" y2="26" />
                  </g>
                )}
                {batch.status === "HARVEST_READY" && (
                  <g className="farm-plot-crop">
                    <circle cx="38" cy="32" r="6" />
                    <circle cx="50" cy="24" r="7" />
                    <circle cx="62" cy="32" r="6" />
                    <circle cx="50" cy="42" r="6" />
                  </g>
                )}
                {batch.status === "HARVESTED" && (
                  <g className="farm-plot-stubble">
                    <line x1="34" y1="38" x2="42" y2="30" />
                    <line x1="46" y1="40" x2="54" y2="30" />
                    <line x1="58" y1="38" x2="66" y2="30" />
                  </g>
                )}
                {batch.status === "PLANNED" && (
                  <g className="farm-plot-soil">
                    <circle cx="42" cy="34" r="1.6" />
                    <circle cx="50" cy="30" r="1.6" />
                    <circle cx="58" cy="34" r="1.6" />
                    <circle cx="50" cy="40" r="1.6" />
                  </g>
                )}
                {hasOpportunity && <circle className="farm-badge" cx="88" cy="12" r="9" />}
              </svg>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
