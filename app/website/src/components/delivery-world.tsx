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
  Maximize2,
  Minus,
  Move,
  PackageCheck,
  Plus,
  Route,
  Sprout,
  Truck,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import { Badge, Card, EmptyState, SectionTitle } from "@/components/ui";
import { IslandGameCanvas } from "@/components/island-game-canvas";
import { formatDate, titleCase } from "@/lib/format";

export type DeliveryMissionView = ApiSchema<"DeliveryMissionView">;
export type DeliveryUpdate = ApiSchema<"DeliveryUpdate">;
export type Vehicle = ApiSchema<"Vehicle">;
type DeliveryCargo = ApiSchema<"DeliveryCargo">;

const pickupAnchors = [
  { x: 235, y: 397 },
  { x: 286, y: 180 },
  { x: 494, y: 200 },
  { x: 628, y: 390 },
];
const dropoffAnchors = [
  { x: 706, y: 304 },
  { x: 748, y: 397 },
];
const routeStart = { x: 830, y: 475 };
const cropStages = ["PLANNED", "GROWING", "HARVEST_READY", "HARVESTED", "CLOSED"] as const;

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

export function CropProgressPlot({ cargo, quantityLabel = "committed" }: { cargo: DeliveryCargo; quantityLabel?: string }) {
  const status = cargo.cropStatus ?? "PLANNED";
  const currentStage = cropStages.indexOf(status);
  return (
    <article className="crop-progress-plot" data-crop={cargo.cropType.toLowerCase()} data-stage={status.toLowerCase()}>
      <PlantArt cropType={cargo.cropType} status={status} />
      <div className="crop-progress-copy">
        <div><Badge>{status}</Badge><strong>{cargo.quantity.value} kg {quantityLabel}</strong></div>
        <h4>{cropLabel(cargo.cropType)} field</h4>
        <div className="crop-stage-track" aria-label={`${cropLabel(cargo.cropType)} growth progress`}>
          {cropStages.map((stage, index) => (
            <span className={`${index < currentStage ? "is-complete" : ""} ${index === currentStage ? "is-current" : ""}`} key={stage}>
              <i>{index < currentStage ? <Check size={11} /> : index + 1}</i>
              <small>{titleCase(stage).replace("Harvest Ready", "Ready")}</small>
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

const fieldPositions = [
  [34, 37], [41, 40], [48, 43], [55, 46], [62, 49], [69, 52],
  [39, 48], [46, 51], [53, 54], [60, 57], [67, 60], [74, 63],
] as const;

function FarmFieldCrops({ cargo }: { cargo: DeliveryCargo }) {
  const status = cargo.cropStatus ?? "PLANNED";
  const count = status === "GROWING" ? 8 : status === "HARVEST_READY" ? 12 : status === "PLANNED" ? 5 : 0;
  const cropSprite = cargo.cropType === "CUCUMBER"
    ? "/art/cucumber-game.webp"
    : cargo.cropType === "DASHEEN" ? "/art/dasheen-game.webp" : undefined;

  return (
    <div className={`farm-field-crops is-${status.toLowerCase()}`} aria-hidden="true">
      {fieldPositions.slice(0, count).map(([left, top], index) => (
        <span className="field-crop-sprite" style={{ left: `${left}%`, top: `${top}%`, "--plant-delay": `${index * -0.17}s` } as CSSProperties} key={`${left}-${top}`}>
          <i />
          {cropSprite && status !== "PLANNED"
            ? <Image className="field-crop-art" src={cropSprite} alt="" width={96} height={96} />
            : <Sprout className="field-crop-fallback" size={22} />}
          {status === "HARVEST_READY" && <span className="crop-ready-spark" />}
        </span>
      ))}
      {status === "HARVESTED" && <span className="harvest-crates">📦 📦</span>}
      {status === "CLOSED" && <span className="closed-field-sign">Field cycle complete</span>}
    </div>
  );
}

function FarmProgressScene({ farmName, cargo, leaving, onBack }: { farmName: string; cargo: DeliveryCargo[]; leaving: boolean; onBack: () => void }) {
  return (
    <div className={`farm-progress-scene ${leaving ? "is-leaving" : ""}`}>
      <Image className="farm-scene-art" src="/art/saint-lucia-farm.png" alt="" fill sizes="(max-width: 800px) 100vw, 70vw" priority />
      <FarmFieldCrops cargo={cargo[0]!} />
      <div className="farm-progress-header">
        <button type="button" className="world-back-button" onClick={onBack}><ArrowLeft size={16} />Back to island</button>
        <div><span>Live farm view</span><h3>{farmName}</h3><small>Order-linked crops only</small></div>
      </div>
      <div className="crop-progress-grid">
        {cargo.map((item) => <CropProgressPlot cargo={item} key={item.cropBatchId} />)}
      </div>
      <p className="scope-note"><PackageCheck size={16} />Only crops committed to this delivery are shown.</p>
    </div>
  );
}

function IslandBackdrop() {
  return (
    <Image
      className="island-art"
      src="/art/saint-lucia-delivery-island.png"
      alt=""
      fill
      sizes="(max-width: 800px) 100vw, 75vw"
      priority
      draggable={false}
    />
  );
}

export function EmptyIslandWorld({ title = "The island is quiet", detail = "Delivery routes will appear here as soon as an order is ready to move." }: { title?: string; detail?: string }) {
  return (
    <Card className="delivery-journey empty-island-world">
      <div className="journey-heading">
        <div className="journey-title-lockup"><span>Island map</span><SectionTitle title="Saint Lucia delivery world" detail="Explore local farm-to-hotel routes" /></div>
      </div>
      <div className="journey-layout">
        <div className="island-stage empty-island-stage">
          <IslandBackdrop />
          <div className="empty-world-message"><Sprout size={27} /><EmptyState title={title} detail={detail} /></div>
        </div>
      </div>
    </Card>
  );
}

export function DeliveryJourney({
  mission,
  updates = [],
  controls,
  compact = false,
  detailsInitiallyOpen = false,
  immersive = false,
  onWorldModeChange,
  vehicleLabel,
}: {
  mission: DeliveryMissionView;
  updates?: DeliveryUpdate[];
  controls?: ReactNode;
  compact?: boolean;
  detailsInitiallyOpen?: boolean;
  immersive?: boolean;
  onWorldModeChange?: (mode: "MAP" | "FARM") => void;
  vehicleLabel?: string;
}) {
  const anchors = useMemo(() => routeAnchors(mission), [mission]);
  const [selectedStop, setSelectedStop] = useState(Math.max(1, mission.currentStopSequence || 1));
  const [zoomFarmId, setZoomFarmId] = useState<string | null>(null);
  const [mapView, setMapView] = useState({ x: 0, y: 0, zoom: 1 });
  const [detailsOpen, setDetailsOpen] = useState(detailsInitiallyOpen);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [farmLeaving, setFarmLeaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rendererReady, setRendererReady] = useState(false);
  const transitionTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const inertiaFrame = useRef<number | null>(null);
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    lastCenter: { x: number; y: number };
    lastDistance?: number;
    lastTime: number;
    velocityX: number;
    velocityY: number;
  } | null>(null);
  const zoomCargo = zoomFarmId ? mission.cargo.filter((item) => item.farmId === zoomFarmId && item.cropStatus) : [];
  const zoomFarm = zoomCargo[0]?.farmName;
  const points = [routeStart, ...anchors];
  const gamePoints = points.map((point) => ({ x: point.x / 920, y: point.y / 560 }));
  const gameMarkers = [
    { kind: "DEPOT" as const, label: "Driver base", point: { x: routeStart.x / 920, y: routeStart.y / 560 }, sequence: 0 },
    ...mission.stops.map((stop, index) => ({
      kind: stop.kind,
      label: stop.displayName,
      point: { x: anchors[index]!.x / 920, y: anchors[index]!.y / 560 },
      sequence: stop.sequence,
    })),
  ];
  const moving = mission.status === "IN_TRANSIT" && mission.currentStopSequence < mission.stops.length;
  const worldStyle = {
    transform: `translate3d(${mapView.x}px, ${mapView.y}px, 0) scale(${mapView.zoom})`,
  } as CSSProperties;
  const latestDelay = [...updates].reverse().find((update) => update.updateType === "DELAYED");

  useEffect(() => () => {
    transitionTimers.current.forEach(clearTimeout);
    if (inertiaFrame.current !== null) cancelAnimationFrame(inertiaFrame.current);
  }, []);

  function scheduleTransition(callback: () => void, delay: number) {
    const timer = setTimeout(callback, delay);
    transitionTimers.current.push(timer);
  }

  function openFarm(stopSequence: number, farmId: string, anchor: { x: number; y: number }) {
    setSelectedStop(stopSequence);
    setDetailsOpen(false);
    if (process.env.NODE_ENV === "test") {
      setZoomFarmId(farmId);
      onWorldModeChange?.("FARM");
      return;
    }
    transitionTimers.current.forEach(clearTimeout);
    transitionTimers.current = [];
    setCameraBusy(true);
    setMapView({
      x: Math.max(-220, Math.min(220, (0.5 - anchor.x / 920) * 340)),
      y: Math.max(-140, Math.min(140, (0.5 - anchor.y / 560) * 220)),
      zoom: 1.48,
    });
    scheduleTransition(() => {
      setZoomFarmId(farmId);
      setCameraBusy(false);
      onWorldModeChange?.("FARM");
    }, 560);
  }

  function closeFarm() {
    if (process.env.NODE_ENV === "test") {
      setZoomFarmId(null);
      setMapView({ x: 0, y: 0, zoom: 1 });
      onWorldModeChange?.("MAP");
      return;
    }
    setFarmLeaving(true);
    scheduleTransition(() => {
      setZoomFarmId(null);
      setFarmLeaving(false);
      onWorldModeChange?.("MAP");
      setCameraBusy(true);
      requestAnimationFrame(() => setMapView({ x: 0, y: 0, zoom: 1 }));
      scheduleTransition(() => setCameraBusy(false), 680);
    }, 430);
  }

  function changeZoom(delta: number) {
    setMapView((current) => clampMapView(current.x, current.y, Number((current.zoom + delta).toFixed(1))));
  }

  function panBy(x: number, y: number) {
    setMapView((current) => clampMapView(current.x + x, current.y + y, current.zoom));
  }

  function clampMapView(x: number, y: number, zoom: number) {
    const boundedZoom = Math.min(1.8, Math.max(1, zoom));
    const horizontalLimit = 220 + Math.max(0, boundedZoom - 1) * 180;
    const verticalLimit = 140 + Math.max(0, boundedZoom - 1) * 130;
    return {
      x: Math.max(-horizontalLimit, Math.min(horizontalLimit, x)),
      y: Math.max(-verticalLimit, Math.min(verticalLimit, y)),
      zoom: boundedZoom,
    };
  }

  function pointerCenter(pointers: Map<number, { x: number; y: number }>) {
    const points = [...pointers.values()];
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }

  function pointerDistance(pointers: Map<number, { x: number; y: number }>) {
    const points = [...pointers.values()];
    if (points.length < 2) return undefined;
    return Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
  }

  function onMapKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const movement = { ArrowLeft: [28, 0], ArrowRight: [-28, 0], ArrowUp: [0, 28], ArrowDown: [0, -28] }[event.key];
    if (!movement) return;
    event.preventDefault();
    panBy(movement[0]!, movement[1]!);
  }

  function onMapPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    if (inertiaFrame.current !== null) {
      cancelAnimationFrame(inertiaFrame.current);
      inertiaFrame.current = null;
    }
    const point = { x: event.clientX, y: event.clientY };
    if (!gesture.current) {
      gesture.current = {
        pointers: new Map([[event.pointerId, point]]),
        lastCenter: point,
        lastTime: event.timeStamp,
        velocityX: 0,
        velocityY: 0,
      };
    } else {
      gesture.current.pointers.set(event.pointerId, point);
      gesture.current.lastCenter = pointerCenter(gesture.current.pointers);
      gesture.current.lastDistance = pointerDistance(gesture.current.pointers);
      gesture.current.lastTime = event.timeStamp;
    }
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onMapPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const currentGesture = gesture.current;
    if (!currentGesture?.pointers.has(event.pointerId)) return;
    currentGesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const center = pointerCenter(currentGesture.pointers);
    const distance = pointerDistance(currentGesture.pointers);
    const deltaX = center.x - currentGesture.lastCenter.x;
    const deltaY = center.y - currentGesture.lastCenter.y;
    const elapsed = Math.max(8, event.timeStamp - currentGesture.lastTime);

    setMapView((current) => {
      const zoomRatio = distance && currentGesture.lastDistance ? distance / currentGesture.lastDistance : 1;
      const nextZoom = current.zoom * zoomRatio;
      return clampMapView(current.x + deltaX, current.y + deltaY, nextZoom);
    });

    currentGesture.velocityX = deltaX / elapsed * 16;
    currentGesture.velocityY = deltaY / elapsed * 16;
    currentGesture.lastCenter = center;
    currentGesture.lastDistance = distance;
    currentGesture.lastTime = event.timeStamp;
  }

  function stopDragging(event: ReactPointerEvent<HTMLDivElement>) {
    const currentGesture = gesture.current;
    if (!currentGesture?.pointers.has(event.pointerId)) return;
    currentGesture.pointers.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (currentGesture.pointers.size) {
      currentGesture.lastCenter = pointerCenter(currentGesture.pointers);
      currentGesture.lastDistance = pointerDistance(currentGesture.pointers);
      currentGesture.lastTime = event.timeStamp;
      return;
    }

    gesture.current = null;
    setDragging(false);
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let velocityX = currentGesture.velocityX;
    let velocityY = currentGesture.velocityY;
    const glide = () => {
      velocityX *= 0.9;
      velocityY *= 0.9;
      if (Math.abs(velocityX) < 0.2 && Math.abs(velocityY) < 0.2) {
        inertiaFrame.current = null;
        return;
      }
      setMapView((current) => clampMapView(current.x + velocityX, current.y + velocityY, current.zoom));
      inertiaFrame.current = requestAnimationFrame(glide);
    };
    if (Math.abs(velocityX) >= 0.2 || Math.abs(velocityY) >= 0.2) inertiaFrame.current = requestAnimationFrame(glide);
  }

  return (
    <Card className={`delivery-journey ${compact ? "is-compact" : ""} ${immersive ? "is-immersive" : ""}`}>
      <div className="journey-heading">
        <div className="journey-title-lockup"><span>Island route</span><SectionTitle title="Saint Lucia delivery journey" detail={`${mission.stops.length} local stops`} /></div>
        <div className="journey-labels"><Badge>{mission.status}</Badge>{mission.atRisk && <Badge tone="high">At risk</Badge>}</div>
      </div>
      <div className="journey-layout">
        <div
          className={`island-stage ${dragging ? "is-dragging" : ""} ${cameraBusy ? "is-camera-moving" : ""}`}
          tabIndex={zoomFarm ? -1 : 0}
          aria-busy={cameraBusy}
          aria-label="Interactive Saint Lucia delivery map. Drag to move the island, or use the arrow keys."
          onKeyDown={onMapKeyDown}
          onPointerDown={onMapPointerDown}
          onPointerMove={onMapPointerMove}
          onPointerUp={stopDragging}
          onPointerCancel={stopDragging}
        >
          {zoomFarm && zoomCargo.length ? (
            <FarmProgressScene farmName={zoomFarm} cargo={zoomCargo} leaving={farmLeaving} onBack={closeFarm} />
          ) : (
            <>
              <div className="world-pan-layer" style={worldStyle} data-zoom={mapView.zoom.toFixed(1)}>
                <div className={`world-scene-surface ${rendererReady ? "is-game-ready" : ""}`}>
                  <IslandBackdrop />
                  <IslandGameCanvas
                    activeSegment={mission.status === "DELIVERED" ? points.length - 2 : mission.currentStopSequence}
                    delivered={mission.status === "DELIVERED"}
                    markers={gameMarkers}
                    moving={moving}
                    onReady={() => setRendererReady(true)}
                    points={gamePoints}
                    selectedStop={selectedStop}
                  />
                  {mission.stops.map((stop, index) => {
                    const anchor = anchors[index]!;
                    const cargo = stop.farmId ? mission.cargo.filter((item) => item.farmId === stop.farmId && item.cropStatus) : [];
                    const canZoom = stop.kind === "PICKUP" && cargo.length > 0;
                    return (
                      <button
                        type="button"
                        className={`route-node route-node-${stop.kind.toLowerCase()} ${selectedStop === stop.sequence ? "is-selected" : ""}`}
                        style={{ left: `${anchor.x / 9.2}%`, top: `${anchor.y / 5.6}%`, "--marker-delay": `${index * -0.28}s` } as CSSProperties}
                        aria-label={`${stop.kind === "PICKUP" ? "Farm" : "Hotel"} stop ${stop.sequence}: ${stop.displayName}${canZoom ? ". Open crop progress" : ""}`}
                        aria-pressed={selectedStop === stop.sequence}
                        onClick={() => {
                          setSelectedStop(stop.sequence);
                          if (canZoom && stop.farmId) openFarm(stop.sequence, stop.farmId, anchor);
                        }}
                        key={`${stop.sequence}-${stop.displayName}`}
                      >
                        <span className="route-node-icon">{stop.kind === "PICKUP" ? <Sprout size={18} /> : <Flag size={18} />}</span>
                        <span><b>{stop.sequence}</b>{stop.displayName}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="world-map-hint"><Move size={15} /><span>Illustrated island · drag to explore</span></div>
              <div className="world-map-controls" aria-label="Map controls">
                <button type="button" onClick={() => changeZoom(.2)} aria-label="Zoom in"><Plus size={18} /></button>
                <button type="button" onClick={() => changeZoom(-.2)} aria-label="Zoom out" disabled={mapView.zoom === 1}><Minus size={18} /></button>
                <button type="button" onClick={() => setMapView({ x: 0, y: 0, zoom: 1 })} aria-label="Reset map view"><Maximize2 size={17} /></button>
              </div>
              {mission.atRisk && <span className="journey-warning" aria-hidden="true"><AlertTriangle size={19} /></span>}
            </>
          )}
        </div>
        <button type="button" className="map-detail-toggle" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)}>
          <PackageCheck size={17} />{detailsOpen ? "Hide route card" : "Show route card"}
        </button>
        <div className={`journey-panel ${detailsOpen ? "is-open" : ""}`}>
          <div className="journey-panel-handle"><span>Route card</span><button type="button" aria-label="Close route card" onClick={() => setDetailsOpen(false)}>×</button></div>
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
              const cargo = stop.farmId ? mission.cargo.filter((item) => item.farmId === stop.farmId && item.cropStatus) : [];
              return (
                <li className={`${complete ? "is-complete" : ""} ${current ? "is-current" : ""}`} key={stop.sequence}>
                  <button type="button" onClick={() => {
                    setSelectedStop(stop.sequence);
                    if (cargo.length && stop.farmId) openFarm(stop.sequence, stop.farmId, anchors[stop.sequence - 1]!);
                  }} aria-pressed={selectedStop === stop.sequence}>
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
