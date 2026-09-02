import type { ApiSchema } from "@harvest/shared";
import Link from "next/link";

import { titleCase } from "@/lib/format";

type CropBatch = ApiSchema<"CropBatch">;
type MarketOpportunity = ApiSchema<"MarketOpportunity">;
type DeliveryMission = ApiSchema<"DeliveryMission">;

const VIEW_W = 800;
const VIEW_H = 480;
const FIELD_CENTER_Y = 172;
const TILE_BOX = 132;
const BASE_TILE_W = 150;
const BASE_TILE_H = 94;
const SCALE_MIN = 0.68;
const SCALE_MAX = 1.3;
const QUANTITY_CAP = 260;
const MIN_FIELD_SLOTS = 6;
const REST_SCALE = 0.62;

function atpScale(value: number) {
  const clamped = Math.max(0, Math.min(QUANTITY_CAP, value));
  return SCALE_MIN + (SCALE_MAX - SCALE_MIN) * (clamped / QUANTITY_CAP);
}

function gridDimensions(total: number) {
  const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(total))));
  const rows = Math.max(1, Math.ceil(total / cols));
  return { cols, rows };
}

interface GridSlot {
  x: number;
  y: number;
  centrality: number;
}

/**
 * Lays out `total` isometric grid cells, centred on the field. Each slot also
 * carries its squared distance from the grid center so callers can hand the
 * most central cells to real data and push the rest to the edges.
 */
function buildGridSlots(total: number, boost: number): GridSlot[] {
  const { cols, rows } = gridDimensions(total);
  const centerCol = (cols - 1) / 2;
  const centerRow = (rows - 1) / 2;
  const tileW = BASE_TILE_W * boost;
  const tileH = BASE_TILE_H * boost;
  return Array.from({ length: total }, (_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = VIEW_W / 2 + (col - centerCol - (row - centerRow)) * (tileW / 2);
    const y = FIELD_CENTER_Y + (col - centerCol + (row - centerRow)) * (tileH / 2);
    const centrality = (col - centerCol) ** 2 + (row - centerRow) ** 2;
    return { x, y, centrality };
  });
}

function diamondPoints(cx: number, cy: number, width: number, height: number) {
  const hw = width / 2;
  const hh = height / 2;
  return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
}

function accessibleName(batch: CropBatch) {
  const status = batch.status.toLowerCase().replaceAll("_", " ");
  return `${titleCase(batch.cropType)} batch, ${status}, ${batch.availableToPromise.value} kg available`;
}

const FENCE_START_Y = 344;
const FENCE_END_Y = 288;
const FENCE_POSTS = [0, 100, 200, 300, 400, 500, 600, 700, 800];

function fenceY(x: number) {
  return FENCE_START_Y + (FENCE_END_Y - FENCE_START_Y) * (x / VIEW_W);
}

const TREES = [
  { x: 168, y: 36, scale: 0.85 },
  { x: 322, y: 22, scale: 1 },
  { x: 470, y: 30, scale: 0.78 },
  { x: 700, y: 40, scale: 0.9 },
  { x: 750, y: 198, scale: 1.05 },
];

/** A simple original palm/tree sprite: a trunk plus two overlapping foliage circles. */
function Tree({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`} className="farm-tree">
      <rect className="farm-tree-trunk" x="-3" y="6" width="6" height="17" rx="1.5" />
      <circle className="farm-tree-back" cx="-7" cy="-1" r="11" />
      <circle className="farm-tree-front" cx="6" cy="-4" r="12" />
    </g>
  );
}

/**
 * A stylised, original 2D isometric view of the signed-in farmer's plots. Each
 * plot is a crop batch: its footprint scales with what is currently safe to
 * promise, its ground cover reflects the batch status, and an amber marker
 * appears when a buyer is currently asking for that crop. When a farmer has
 * few batches, faint "resting" plots fill out a minimum-size field grid so
 * the map still reads as a farm instead of a mostly empty page, and the real
 * plots grow to fill the extra room. Purely presentational; all data comes
 * from the caller.
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

  const realCount = batches.length;
  const showRestingGrid = realCount < MIN_FIELD_SLOTS;
  const layoutBoost = realCount >= 1 && realCount <= 3 ? 1.5 : 1;
  const totalSlots = showRestingGrid ? MIN_FIELD_SLOTS : realCount;
  const rawSlots = buildGridSlots(totalSlots, layoutBoost);
  // With room to spare, hand the most central cells to real plots so a
  // handful of batches cluster near the middle of the field instead of
  // defaulting to a top-left corner, with resting plots filling the rest.
  const orderedSlots = showRestingGrid ? [...rawSlots].sort((a, b) => a.centrality - b.centrality) : rawSlots;
  const realSlots = orderedSlots.slice(0, realCount);
  const restingSlots = showRestingGrid ? orderedSlots.slice(realCount) : [];
  const restingW = TILE_BOX * REST_SCALE * layoutBoost;
  const restingH = restingW * 0.72;

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
        <rect x="0" y="0" width={VIEW_W} height="58" className="farm-horizon" />
        <polygon points="30,58 770,58 770,304 30,304" fill="var(--mint)" opacity="0.35" />
        <polygon points="0,352 800,296 800,412 0,468" fill="var(--amber)" opacity="0.4" />
        <line x1="8" y1="410" x2="792" y2="352" stroke="var(--cream)" strokeWidth="4" strokeDasharray="16 12" opacity="0.85" />

        <g className="farm-fence">
          <polyline points={`0,${fenceY(0)} 800,${fenceY(800)}`} />
          {FENCE_POSTS.map((x) => (
            <line key={x} x1={x} y1={fenceY(x) - 9} x2={x} y2={fenceY(x) + 5} />
          ))}
        </g>

        {restingSlots.map((slot, index) => (
          <polygon
            key={`rest-${index}`}
            className="farm-plot-resting"
            points={diamondPoints(slot.x, slot.y, restingW, restingH)}
          />
        ))}

        <g className="farm-market">
          <rect x="46" y="150" width="72" height="60" rx="4" fill="var(--cream)" stroke="var(--forest)" strokeWidth="2" />
          <polygon points="40,150 82,110 124,150" fill="var(--forest)" />
          <rect x="70" y="176" width="20" height="34" fill="var(--forest-dark)" />
          <circle cx="102" cy="168" r="5" fill="var(--blue)" />
        </g>

        {TREES.map((tree, index) => (
          <Tree key={index} x={tree.x} y={tree.y} scale={tree.scale} />
        ))}

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
          const slot = realSlots[index] ?? { x: VIEW_W / 2, y: FIELD_CENTER_Y, centrality: 0 };
          const scale = atpScale(batch.availableToPromise.value) * layoutBoost;
          const boxSize = TILE_BOX * scale;
          const hasOpportunity = opportunityCropTypes.has(batch.cropType.toLowerCase());
          const statusClass = batch.status.toLowerCase().replaceAll("_", "-");
          const clipId = `farm-plot-clip-${batch.cropBatchId}`;

          return (
            <Link
              key={batch.cropBatchId}
              href={`/crops/${batch.cropBatchId}`}
              className={`farm-plot farm-plot-${statusClass}`}
              aria-label={accessibleName(batch)}
              style={{
                left: `${(slot.x / VIEW_W) * 100}%`,
                top: `${(slot.y / VIEW_H) * 100}%`,
                width: `${(boxSize / VIEW_W) * 100}%`,
                height: `${((boxSize * 0.72) / VIEW_H) * 100}%`,
              }}
            >
              <svg viewBox="0 0 100 70" aria-hidden="true" focusable="false">
                <defs>
                  <clipPath id={clipId}>
                    <polygon points="50,4 96,35 50,66 4,35" />
                  </clipPath>
                </defs>
                <polygon className="farm-plot-shadow" points="53,8 99,39 53,70 7,39" />
                <polygon className="farm-plot-shape" points="50,4 96,35 50,66 4,35" />
                <g clipPath={`url(#${clipId})`} className="farm-plot-furrows">
                  <line x1="14" y1="22" x2="86" y2="22" />
                  <line x1="10" y1="33" x2="90" y2="33" />
                  <line x1="14" y1="44" x2="86" y2="44" />
                  <line x1="20" y1="55" x2="80" y2="55" />
                </g>
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
