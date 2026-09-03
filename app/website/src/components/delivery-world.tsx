"use client";

import type { ApiSchema } from "@harvest/shared";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Flag,
  MapPin,
  PackageCheck,
  Route,
  Sprout,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui";
import { formatDate, titleCase } from "@/lib/format";

export type DeliveryMissionView = ApiSchema<"DeliveryMissionView">;
export type DeliveryUpdate = ApiSchema<"DeliveryUpdate">;
export type Vehicle = ApiSchema<"Vehicle">;
type DeliveryCargo = ApiSchema<"DeliveryCargo">;

const pickupAnchors = [
  { x: 235, y: 150 },
  { x: 665, y: 150 },
  { x: 205, y: 390 },
  { x: 690, y: 390 },
];
const dropoffAnchors = [
  { x: 472, y: 275 },
  { x: 520, y: 400 },
];
const routeStart = { x: 82, y: 486 };

function cropLabel(cropType: string) {
  return titleCase(cropType || "Produce");
}

function cropMark(cropType: string) {
  if (cropType === "CUCUMBER") return "CU";
  if (cropType === "DASHEEN") return "DA";
  return cropType.slice(0, 2).toUpperCase() || "PR";
}

function routeAnchors(mission: DeliveryMissionView) {
  let pickupIndex = 0;
  let dropoffIndex = 0;
  return mission.stops.map((stop) => {
    if (stop.kind === "PICKUP") {
      const anchor = pickupAnchors[pickupIndex % pickupAnchors.length]!;
      pickupIndex += 1;
      return anchor;
    }
    const anchor = dropoffAnchors[dropoffIndex % dropoffAnchors.length]!;
    dropoffIndex += 1;
    return anchor;
  });
}

function dueLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DeliveryBoard({
  missions,
  selectedMissionId,
  onSelect,
}: {
  missions: DeliveryMissionView[];
  selectedMissionId?: string;
  onSelect: (missionId: string) => void;
}) {
  const available = missions.filter((mission) => mission.status === "AVAILABLE");
  const assigned = missions.filter((mission) => mission.status !== "AVAILABLE" && mission.status !== "CANCELLED");
  const cancelled = missions.filter((mission) => mission.status === "CANCELLED");
  const groups = [
    { label: "Ready to claim", items: available },
    { label: "My routes", items: assigned },
    { label: "Cancelled", items: cancelled },
  ].filter((group) => group.items.length);

  if (!missions.length) {
    return <EmptyState title="No delivery tickets yet" detail="Approved local orders will be pinned here automatically." />;
  }

  return (
    <div className="delivery-ticket-groups">
      {groups.map((group) => (
        <section aria-labelledby={`mission-group-${group.label.replaceAll(" ", "-")}`} key={group.label}>
          <div className="delivery-ticket-heading">
            <h3 id={`mission-group-${group.label.replaceAll(" ", "-")}`}>{group.label}</h3>
            <span>{group.items.length}</span>
          </div>
          <div className="delivery-ticket-grid">
            {group.items.map((mission, index) => {
              const selected = mission.missionId === selectedMissionId;
              return (
                <button
                  type="button"
                  className={`delivery-ticket ${selected ? "is-selected" : ""}`}
                  aria-pressed={selected}
                  onClick={() => onSelect(mission.missionId)}
                  key={mission.missionId}
                >
                  <span className={`ticket-pin pin-${index % 3}`} aria-hidden="true" />
                  <span className="ticket-topline">
                    <span className="crop-stamp" aria-hidden="true">{cropMark(mission.cropType)}</span>
                    <Badge tone={mission.atRisk ? "high" : undefined}>{mission.atRisk ? "At risk" : mission.status}</Badge>
                  </span>
                  <strong>{mission.quantity.value} kg {cropLabel(mission.cropType)}</strong>
                  <span className="ticket-destination">to {mission.buyerName}</span>
                  <span className="ticket-meta"><MapPin size={14} />{mission.stops.length} stops</span>
                  <span className="ticket-meta"><Clock3 size={14} />Due {dueLabel(mission.deadline)}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function PlantArt({ cropType, status }: { cropType: string; status: NonNullable<DeliveryCargo["cropStatus"]> }) {
  const mature = status === "HARVEST_READY";
  const growing = status === "GROWING" || mature;
  const harvested = status === "HARVESTED";
  const closed = status === "CLOSED";
  const plants = growing ? [58, 110, 162] : [];
  const dasheen = cropType === "DASHEEN";
  const cucumber = cropType === "CUCUMBER";

  return (
    <svg viewBox="0 0 220 145" aria-hidden="true" focusable="false">
      <path className="crop-hill-shadow" d="M22 105 91 67l108 22-70 42Z" />
      <path className={`crop-hill ${closed ? "is-closed" : ""}`} d="M16 95 88 56l116 24-73 43Z" />
      {[72, 91, 110].map((y) => <path className="crop-furrow" d={`M36 ${y} 130 ${y + 20} 184 ${y - 9}`} key={y} />)}
      {status === "PLANNED" && [62, 105, 150].map((x) => <circle className="crop-seed" cx={x} cy={92 + (x % 3) * 4} r="4" key={x} />)}
      {plants.map((x, index) => dasheen ? (
        <g className={mature ? "crop-plant is-ready" : "crop-plant"} transform={`translate(${x} ${82 + index * 5})`} key={x}>
          <path className="crop-stem" d="M0 25V-2" />
          <path className="dasheen-leaf" d="M0 3C-25-4-23-29 0-23 23-31 30-5 0 3Z" />
          {mature && <ellipse className="dasheen-root" cx="2" cy="29" rx="9" ry="5" />}
        </g>
      ) : cucumber ? (
        <g className={mature ? "crop-plant is-ready" : "crop-plant"} transform={`translate(${x} ${83 + index * 5})`} key={x}>
          <path className="crop-stem" d="M0 24C-2 10 3 2 0-10" />
          <ellipse className="cucumber-leaf" cx="-8" cy="6" rx="10" ry="6" transform="rotate(-28 -8 6)" />
          <ellipse className="cucumber-leaf" cx="8" cy="-2" rx="10" ry="6" transform="rotate(28 8 -2)" />
          {mature && <rect className="cucumber-fruit" x="-4" y="10" width="8" height="22" rx="4" transform="rotate(12 0 21)" />}
        </g>
      ) : (
        <g className={mature ? "crop-plant is-ready" : "crop-plant"} transform={`translate(${x} ${83 + index * 5})`} key={x}>
          <path className="crop-stem" d="M0 24V-9" />
          <circle className="generic-leaf" cx="-8" cy="2" r="7" />
          <circle className="generic-leaf" cx="8" cy="-5" r="7" />
          {mature && <circle className="generic-produce" cy="13" r="7" />}
        </g>
      ))}
      {harvested && [58, 110, 162].map((x) => <path className="crop-stubble" d={`M${x - 6} 102l6-12 5 13m-5-7-6-5m6 5 7-5`} key={x} />)}
      {harvested && <g className="crop-crate" transform="translate(151 89)"><rect width="36" height="25" rx="3" /><path d="M4 7h28M4 15h28" /></g>}
      {closed && <g className="crop-closed-mark" transform="translate(105 86)"><circle r="20" /><path d="m-8-8 16 16m0-16L-8 8" /></g>}
    </svg>
  );
}

export function CropProgressPlot({ cargo }: { cargo: DeliveryCargo }) {
  const status = cargo.cropStatus ?? "PLANNED";
  return (
    <article className="crop-progress-plot" data-crop={cargo.cropType.toLowerCase()} data-stage={status.toLowerCase()}>
      <PlantArt cropType={cargo.cropType} status={status} />
      <div>
        <Badge>{status}</Badge>
        <h4>{cropLabel(cargo.cropType)}</h4>
        <p>{cargo.quantity.value} kg committed to this delivery</p>
      </div>
    </article>
  );
}

function FarmProgressScene({ farmName, cargo, onBack }: { farmName: string; cargo: DeliveryCargo[]; onBack: () => void }) {
  return (
    <div className="farm-progress-scene">
      <div className="farm-progress-header">
        <button type="button" className="world-back-button" onClick={onBack}><ArrowLeft size={16} />Back to island</button>
        <div><span>Order-linked crop progress</span><h3>{farmName}</h3></div>
      </div>
      <div className="crop-progress-grid">
        {cargo.map((item) => <CropProgressPlot cargo={item} key={item.cropBatchId} />)}
      </div>
      <p className="scope-note"><PackageCheck size={16} />Only crops committed to this delivery are shown.</p>
    </div>
  );
}

function IslandBackdrop() {
  const suffix = useId().replaceAll(":", "");
  const oceanId = `harvest-ocean-${suffix}`;
  const islandId = `harvest-island-${suffix}`;
  const shadowId = `island-shadow-${suffix}`;

  return (
    <svg className="island-art" viewBox="0 0 920 560" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={oceanId} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#4ec7c1" /><stop offset="1" stopColor="#207f93" /></linearGradient>
        <linearGradient id={islandId} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#9bd568" /><stop offset="1" stopColor="#3f9b55" /></linearGradient>
        <filter id={shadowId}><feDropShadow dx="0" dy="13" stdDeviation="9" floodColor="#074c59" floodOpacity=".32" /></filter>
      </defs>
      <rect width="920" height="560" rx="28" fill={`url(#${oceanId})`} />
      <g className="ocean-lines"><path d="M45 90c40-15 74-15 114 0m625 16c32-13 60-13 92 0M55 455c45-14 81-14 126 0m592-17c36-13 69-13 105 0" /></g>
      <path className="island-shadow" filter={`url(#${shadowId})`} d="M112 330C71 237 139 119 259 77c100-35 167 13 236-7 109-31 247 19 294 118 43 90-11 201-98 266-83 62-178 25-253 43-102 25-274 8-326-167Z" />
      <path className="island-shore" d="M112 316C71 223 139 105 259 63c100-35 167 13 236-7 109-31 247 19 294 118 43 90-11 201-98 266-83 62-178 25-253 43-102 25-274 8-326-167Z" />
      <path className="island-land" fill={`url(#${islandId})`} d="M127 305c-35-81 26-184 139-222 91-30 160 18 231-4 94-28 222 17 263 103 37 77-12 177-89 235-74 56-164 22-235 40-91 22-263 1-309-152Z" />
      <path className="island-highland" d="M354 133c45-42 103-42 141 2 28 33 16 75-34 89-49 14-81-12-107-91Zm180 180c43-35 96-29 123 13 22 34 4 70-39 77-49 8-72-23-84-90Z" />
      <g className="island-trees"><circle cx="308" cy="204" r="12" /><circle cx="329" cy="219" r="10" /><circle cx="590" cy="221" r="12" /><circle cx="611" cy="207" r="9" /><circle cx="352" cy="388" r="11" /><circle cx="632" cy="360" r="12" /></g>
      <path className="island-road-shadow" d="M79 486C175 472 148 355 211 389S344 323 472 275s151-137 193-125" />
      <path className="island-road" d="M79 486C175 472 148 355 211 389S344 323 472 275s151-137 193-125" />
      <g className="island-buildings" transform="translate(444 241)"><path d="M0 25h56v38H0z" /><path d="m-7 27 35-30 36 30Z" /><rect x="23" y="40" width="11" height="23" /></g>
      <g className="island-dock" transform="translate(42 468)"><path d="M0 31h74" /><path d="M17 10v37m37-37v37" /></g>
    </svg>
  );
}

export function DeliveryJourney({
  mission,
  updates = [],
  controls,
  compact = false,
  vehicleLabel,
}: {
  mission: DeliveryMissionView;
  updates?: DeliveryUpdate[];
  controls?: ReactNode;
  compact?: boolean;
  vehicleLabel?: string;
}) {
  const anchors = useMemo(() => routeAnchors(mission), [mission]);
  const [selectedStop, setSelectedStop] = useState(Math.max(1, mission.currentStopSequence || 1));
  const [zoomFarmId, setZoomFarmId] = useState<string | null>(null);
  const zoomCargo = zoomFarmId ? mission.cargo.filter((item) => item.farmId === zoomFarmId && item.cropStatus) : [];
  const zoomFarm = zoomCargo[0]?.farmName;
  const points = [routeStart, ...anchors];
  const routePath = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
  const currentIndex = Math.min(Math.max(mission.currentStopSequence - 1, 0), anchors.length - 1);
  const from = mission.currentStopSequence === 0 ? routeStart : anchors[currentIndex] ?? routeStart;
  const next = anchors[Math.min(mission.currentStopSequence, anchors.length - 1)] ?? from;
  const moving = mission.status === "IN_TRANSIT" && mission.currentStopSequence < mission.stops.length;
  const truckPoint = mission.status === "DELIVERED" ? anchors.at(-1) ?? from : from;
  const truckStyle = {
    "--truck-from-x": `${moving ? from.x / 9.2 : truckPoint.x / 9.2}%`,
    "--truck-from-y": `${moving ? from.y / 5.6 : truckPoint.y / 5.6}%`,
    "--truck-to-x": `${next.x / 9.2}%`,
    "--truck-to-y": `${next.y / 5.6}%`,
    "--truck-mid-x": `${(from.x + next.x) / 18.4}%`,
    "--truck-mid-y": `${(from.y + next.y) / 11.2}%`,
  } as CSSProperties;
  const latestDelay = [...updates].reverse().find((update) => update.updateType === "DELAYED");

  return (
    <Card className={`delivery-journey ${compact ? "is-compact" : ""}`}>
      <div className="journey-heading">
        <SectionTitle title="Saint Lucia delivery journey" detail={`${mission.stops.length} local stops`} />
        <div className="journey-labels"><Badge>{mission.status}</Badge>{mission.atRisk && <Badge tone="high">At risk</Badge>}</div>
      </div>
      <div className="journey-layout">
        <div className="island-stage">
          {zoomFarm && zoomCargo.length ? (
            <FarmProgressScene farmName={zoomFarm} cargo={zoomCargo} onBack={() => setZoomFarmId(null)} />
          ) : (
            <>
              <IslandBackdrop />
              <svg className="mission-route-line" viewBox="0 0 920 560" aria-hidden="true"><path d={routePath} /></svg>
              <div className="route-start-label"><Route size={14} />Route start</div>
              {mission.stops.map((stop, index) => {
                const anchor = anchors[index]!;
                const cargo = stop.farmId ? mission.cargo.filter((item) => item.farmId === stop.farmId && item.cropStatus) : [];
                const canZoom = stop.kind === "PICKUP" && cargo.length > 0;
                return (
                  <button
                    type="button"
                    className={`route-node route-node-${stop.kind.toLowerCase()} ${selectedStop === stop.sequence ? "is-selected" : ""}`}
                    style={{ left: `${anchor.x / 9.2}%`, top: `${anchor.y / 5.6}%` }}
                    aria-label={`${stop.kind === "PICKUP" ? "Farm" : "Hotel"} stop ${stop.sequence}: ${stop.displayName}${canZoom ? ". Open crop progress" : ""}`}
                    aria-pressed={selectedStop === stop.sequence}
                    onClick={() => {
                      setSelectedStop(stop.sequence);
                      if (canZoom && stop.farmId) setZoomFarmId(stop.farmId);
                    }}
                    key={`${stop.sequence}-${stop.displayName}`}
                  >
                    <span className="route-node-icon">{stop.kind === "PICKUP" ? <Sprout size={18} /> : <Flag size={18} />}</span>
                    <span><b>{stop.sequence}</b>{stop.displayName}</span>
                  </button>
                );
              })}
              <span className={`journey-truck ${moving ? "is-moving" : ""}`} style={truckStyle} aria-hidden="true"><Truck size={23} /></span>
              {mission.atRisk && <span className="journey-warning" aria-hidden="true"><AlertTriangle size={19} /></span>}
            </>
          )}
        </div>
        <div className="journey-panel">
          <div className="estimated-banner"><Truck size={18} /><span><strong>Estimated journey</strong><small>Illustrated route — not live GPS</small></span></div>
          <div className="journey-facts">
            <div><Route size={17} /><span><strong>{mission.estimatedDistanceKm ?? "—"} km</strong><small>Route distance</small></span></div>
            <div><Clock3 size={17} /><span><strong>{mission.estimatedDurationMinutes ?? "—"} min</strong><small>Planned duration</small></span></div>
            <div><Flag size={17} /><span><strong>{mission.estimatedArrival ? dueLabel(mission.estimatedArrival) : "Not estimated"}</strong><small>Estimated arrival</small></span></div>
            <div><PackageCheck size={17} /><span><strong>{mission.quantity.value} kg</strong><small>{cropLabel(mission.cropType)}</small></span></div>
            {vehicleLabel && <div><Truck size={17} /><span><strong>{vehicleLabel}</strong><small>Vehicle</small></span></div>}
          </div>
          {latestDelay && <div className="journey-delay"><AlertTriangle size={17} /><span><strong>Delay reported</strong><small>{latestDelay.note ?? "The coordinator has been notified."}</small></span></div>}
          <ol className="journey-stop-list" aria-label="Ordered delivery stops">
            {mission.stops.map((stop) => {
              const complete = mission.status === "DELIVERED" || stop.sequence < mission.currentStopSequence;
              const current = stop.sequence === mission.currentStopSequence;
              return (
                <li className={`${complete ? "is-complete" : ""} ${current ? "is-current" : ""}`} key={stop.sequence}>
                  <button type="button" onClick={() => setSelectedStop(stop.sequence)} aria-pressed={selectedStop === stop.sequence}>
                    <span>{complete ? <Check size={14} /> : stop.sequence}</span>
                    <span><strong>{stop.displayName}</strong><small>{titleCase(stop.kind)}{stop.quantity ? ` · ${stop.quantity.value} kg` : ""}</small></span>
                  </button>
                </li>
              );
            })}
          </ol>
          {controls && <div className="journey-controls">{controls}</div>}
        </div>
      </div>
    </Card>
  );
}

export function VehiclePicker({ vehicles, value, onChange }: { vehicles: Vehicle[]; value: string; onChange: (vehicleId: string) => void }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const labelId = listId + "-label";
  const valueId = listId + "-value";
  const available = vehicles.filter((vehicle) => vehicle.status === "AVAILABLE" || vehicle.vehicleId === value);
  const selected = vehicles.find((vehicle) => vehicle.vehicleId === value);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") setOpen(false);
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!open) setOpen(true);
    if (!available.length) return;
    const selectedIndex = available.findIndex((vehicle) => vehicle.vehicleId === value);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = selectedIndex < 0
      ? (direction > 0 ? 0 : available.length - 1)
      : (selectedIndex + direction + available.length) % available.length;
    onChange(available[nextIndex]!.vehicleId);
  }

  return (
    <div className="vehicle-picker" onKeyDown={onKeyDown}>
      <span className="vehicle-picker-label" id={labelId}>Vehicle</span>
      <button type="button" className="vehicle-picker-trigger" aria-expanded={open} aria-controls={listId} aria-labelledby={labelId + " " + valueId} onClick={() => setOpen((current) => !current)}>
        <Truck size={18} /><span id={valueId}>{selected?.label ?? "Choose a vehicle"}</span><ChevronDown size={17} />
      </button>
      {open && (
        <div className="vehicle-picker-menu" id={listId} role="listbox" aria-labelledby={labelId}>
          {available.length ? available.map((vehicle) => (
            <button
              type="button"
              role="option"
              aria-selected={vehicle.vehicleId === value}
              className={vehicle.vehicleId === value ? "is-selected" : ""}
              onClick={() => { onChange(vehicle.vehicleId); setOpen(false); }}
              key={vehicle.vehicleId}
            >
              <span><strong>{vehicle.label}</strong><small>{vehicle.capacity ? `${vehicle.capacity.value} kg capacity` : "Capacity not recorded"}</small></span>
              {vehicle.vehicleId === value && <Check size={17} />}
            </button>
          )) : <p>No vehicles are currently available.</p>}
        </div>
      )}
    </div>
  );
}

export function MissionOpenLink({ missionId }: { missionId: string }) {
  return <Link className="button button-secondary" href={`/missions/${missionId}`}><Route size={17} />Open full route</Link>;
}

export function MissionDeadline({ deadline }: { deadline: string }) {
  return <span className="mission-deadline"><Clock3 size={15} />Due {formatDate(deadline)}</span>;
}
