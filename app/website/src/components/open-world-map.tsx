"use client";

import type { ApiSchema } from "@harvest/shared";
import { ArrowLeft, ArrowRight, Building2, Check, ChevronDown, Hotel, ListFilter, MapPin, PackageCheck, Search, Sprout, Store, Truck, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { CropProgressPlot, FarmFieldCrops, type DeliveryMissionView } from "@/components/delivery-world";
import { IslandGameCanvas, type IslandMarker, type IslandMarkerState, type IslandPoint } from "@/components/island-game-canvas";
import { Badge, EmptyState } from "@/components/ui";
import { MapControls } from "@/components/map-controls";
import { IslandLandscape } from "@/components/island-landscape";
import { workspaceIsland } from "@/lib/caribbean-islands";
import { focusIslandCamera } from "@/lib/island-camera";
import { islandSceneSlots, propertyWidthOnIsland } from "@/lib/island-geography";
import { useIslandCamera } from "@/components/use-island-camera";
import { titleCase } from "@/lib/format";

export type WorldMapView = ApiSchema<"WorldMapView">;
export type WorldMapLocation = ApiSchema<"WorldMapLocation">;
type ProductRole = "FARMER" | "BUYER" | "TRANSPORTER" | "COORDINATOR";

export type WorldNode = {
  id: string;
  kind: "FARM" | "HOTEL";
  label: string;
  members: WorldMapLocation[];
  point: IslandPoint;
};

const worldSlots: IslandPoint[] = [
  { x: .24, y: .72 }, { x: .31, y: .34 }, { x: .44, y: .23 }, { x: .55, y: .36 },
  { x: .67, y: .69 }, { x: .77, y: .54 }, { x: .63, y: .24 }, { x: .39, y: .56 },
  { x: .49, y: .73 }, { x: .25, y: .51 }, { x: .70, y: .39 }, { x: .58, y: .55 },
  { x: .42, y: .78 }, { x: .34, y: .67 }, { x: .53, y: .19 }, { x: .73, y: .62 },
  { x: .32, y: .44 }, { x: .48, y: .43 }, { x: .61, y: .45 }, { x: .57, y: .65 },
  { x: .38, y: .28 }, { x: .68, y: .29 }, { x: .29, y: .61 }, { x: .47, y: .62 },
];
const depotPoint = { x: .89, y: .83 };

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

export function layoutWorldLocations(locations: WorldMapLocation[]): WorldNode[] {
  const groups: [string, WorldMapLocation[]][] = locations.length > 18
    ? [...locations.reduce((result, location) => {
        const key = `${location.kind}:${location.serviceZone}`;
        result.set(key, [...(result.get(key) ?? []), location]);
        return result;
      }, new Map<string, WorldMapLocation[]>()).entries()]
    : locations.map((location) => [location.locationId, [location]]);
  const claimed = new Set<number>();

  return groups.sort(([left], [right]) => left.localeCompare(right)).map(([key, members]) => {
    const first = members[0]!;
    let slotIndex = first.kind === "HOTEL" && first.access !== "LOGISTICS"
      ? 5
      : first.kind === "FARM" && first.access === "CROP_PROGRESS"
        ? 7
        : hash(key) % worldSlots.length;
    for (let attempt = 0; attempt < worldSlots.length && claimed.has(slotIndex); attempt += 1) slotIndex = (slotIndex + 5) % worldSlots.length;
    claimed.add(slotIndex);
    return {
      id: key,
      kind: first.kind,
      label: members.length === 1 ? first.displayName : `${first.serviceZone} · ${members.length} ${first.kind === "FARM" ? "farms" : "hotels"}`,
      members,
      point: worldSlots[slotIndex]!,
    };
  });
}

const cropStatePriority = ["HARVEST_READY", "GROWING", "PLANNED", "HARVESTED", "CLOSED"] as const;

export function worldMarkerState(node: WorldNode): IslandMarkerState {
  if (node.kind === "HOTEL") return node.members.some((location) => location.opportunities.length > 0) ? "OPEN" : "QUIET";
  const cropStates = new Set(node.members.flatMap((location) => location.crops.map((crop) => crop.status)));
  return cropStatePriority.find((state) => cropStates.has(state)) ?? "QUIET";
}

function locationHint(location: WorldMapLocation) {
  if (location.access === "CROP_PROGRESS") return "Open crop progress";
  if (location.access === "BUYER_DEMAND") return `Open ${location.opportunities.length} buyer request${location.opportunities.length === 1 ? "" : "s"}`;
  if (location.access === "OWN_ORDERS") return "Open your hotel orders";
  if (location.access === "PUBLIC_SUPPLY") return "Open public supply";
  return "Open logistics location";
}

function dueLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function WorldFarmScene({ location, onBack, onArtReady }: { location: WorldMapLocation; onBack: () => void; onArtReady: () => void }) {
  const crops = location.crops.map((crop) => ({
    cropBatchId: crop.cropBatchId!,
    farmId: location.locationId,
    farmName: location.displayName,
    cropType: crop.cropType,
    cropStatus: crop.status,
    quantity: crop.quantity ?? { value: 0, unit: "kg" as const },
  }));

  return (
    <section className="world-place-scene world-farm-scene" aria-label={`${location.displayName} farm view`}>
      <Image className="farm-scene-art" src="/art/saint-lucia-farm.png" alt="" fill sizes="100vw" priority onLoad={onArtReady} onError={onArtReady} />
      {location.access === "CROP_PROGRESS" && crops[0] && <FarmFieldCrops cargo={crops[0]} />}
      <div className="world-place-header">
        <button type="button" className="world-back-button" onClick={onBack}><ArrowLeft size={17} />Back to island</button>
        <div><span>{location.serviceZone}</span><h2>{location.displayName}</h2></div>
      </div>
      <div className="world-place-content">
        {location.access === "CROP_PROGRESS" && location.crops.length ? (
          <div className="crop-progress-grid world-crop-grid">
            {crops.map((crop, index) => (
              <CropProgressPlot cargo={crop} quantityLabel="available to promise" key={`${crop.cropBatchId ?? crop.cropType}:${index}`} />
            ))}
          </div>
        ) : location.crops.length ? (
          <div className="world-supply-board">
            <h3>Available from this farm</h3>
            {location.crops.map((crop, index) => <div className="world-supply-ticket" key={`${crop.cropBatchId ?? crop.cropType}:${index}`}><Sprout size={20} /><span><strong>{titleCase(crop.cropType)}</strong><small>{crop.quantity?.value ?? "—"} kg listed</small></span></div>)}
            <Link className="button" href="/marketplace">Browse marketplace<ArrowRight size={16} /></Link>
          </div>
        ) : (
          <div className="world-private-place"><Sprout size={30} /><h3>Farm stop</h3></div>
        )}
      </div>
    </section>
  );
}

type HotelCropMatch = {
  crop: WorldMapLocation["crops"][number];
  farm: WorldMapLocation;
};

function HotelOpportunityTicket({ index, matches, opportunity, role }: {
  index: number;
  matches: HotelCropMatch[];
  opportunity: WorldMapLocation["opportunities"][number];
  role: ProductRole;
}) {
  const [matchesOpen, setMatchesOpen] = useState(false);
  const matchListId = `hotel-matches-${opportunity.opportunityId}`;

  return (
    <article className={`hotel-order-ticket ticket-${index % 3}`}>
      <span className="ticket-pin" aria-hidden="true" />
      <Badge>{opportunity.status}</Badge>
      <h4>{opportunity.quantity.value} kg {titleCase(opportunity.cropType)}</h4>
      <p>Needed {dueLabel(opportunity.neededBy)}</p>
      {opportunity.maxUnitPrice && <strong>Up to {opportunity.maxUnitPrice.currency} {opportunity.maxUnitPrice.amount}/kg</strong>}
      {(role === "FARMER" || role === "COORDINATOR") && matches.length > 0 && (
        <div className="hotel-crop-matches">
          <button type="button" aria-expanded={matchesOpen} aria-controls={matchListId} onClick={() => setMatchesOpen((open) => !open)}>
            <Sprout size={16} /><span>{matches.length} matching field{matches.length === 1 ? "" : "s"}</span><ChevronDown className={matchesOpen ? "is-open" : ""} size={16} />
          </button>
          {matchesOpen && (
            <div className="hotel-crop-match-list" id={matchListId}>
              {matches.map(({ crop, farm }) => (
                <Link href={`/crops/${crop.cropBatchId}`} aria-label={`Open ${titleCase(crop.cropType)} at ${farm.displayName}`} key={crop.cropBatchId}>
                  <span><strong>{farm.displayName}</strong><small>{crop.quantity?.value ?? "—"} kg · {crop.status ? titleCase(crop.status) : "Status unavailable"}</small></span><ArrowRight size={15} />
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function WorldHotelScene({ location, world, role, onBack, onArtReady }: { location: WorldMapLocation; world: WorldMapView; role: ProductRole; onBack: () => void; onArtReady: () => void }) {
  const hotelArt = ["/art/hotel-location-game.webp", "/art/hotel-location-boutique.webp", "/art/hotel-location-eco.webp"][hash(location.locationId) % 3]!;
  return (
    <section className="world-place-scene world-hotel-scene" aria-label={`${location.displayName} hotel view`}>
      <div className="hotel-scene-sky" aria-hidden="true"><span /><span /><span /></div>
      <Image className="hotel-scene-art" src={hotelArt} alt="" width={512} height={341} priority onLoad={onArtReady} onError={onArtReady} />
      <div className="world-place-header">
        <button type="button" className="world-back-button" onClick={onBack}><ArrowLeft size={17} />Back to island</button>
        <div><span>{location.serviceZone}</span><h2>{location.displayName}</h2></div>
      </div>
      <div className="world-place-content hotel-order-board">
        <div className="hotel-order-board-title"><Store size={23} /><span><small>Order board</small><h3>{location.opportunities.length ? "Produce wanted" : "Hotel deliveries"}</h3></span></div>
        {location.opportunities.length ? location.opportunities.map((opportunity, index) => {
          const matches = world.locations.flatMap((farm) => farm.kind === "FARM" && farm.access === "CROP_PROGRESS"
            ? farm.crops.filter((crop) => crop.cropType === opportunity.cropType && crop.cropBatchId).map((crop) => ({ crop, farm }))
            : []);
          return <HotelOpportunityTicket index={index} matches={matches} opportunity={opportunity} role={role} key={opportunity.opportunityId} />;
        }) : location.access === "OWN_ORDERS" ? (
          <div className="world-private-place"><PackageCheck size={30} /><h3>Your hotel journey board</h3><Link className="button" href="/orders">View orders<ArrowRight size={16} /></Link></div>
        ) : (
          <div className="world-private-place"><Hotel size={30} /><h3>No open requests here</h3></div>
        )}
      </div>
    </section>
  );
}

export function OpenWorldMap({ world, mission, role, onClearRoute, onSceneChange }: {
  world: WorldMapView;
  mission?: DeliveryMissionView;
  role: ProductRole;
  onClearRoute?: () => void;
  onSceneChange?: (open: boolean) => void;
}) {
  const [selectedLocation, setSelectedLocation] = useState<WorldMapLocation>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [directoryQuery, setDirectoryQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"ALL" | "FARM" | "HOTEL">("ALL");
  const [rendererReady, setRendererReady] = useState(false);
  const [enteringPlace, setEnteringPlace] = useState(false);
  const [placeReady, setPlaceReady] = useState(false);
  const revealStarted = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const sceneLayer = useRef<HTMLDivElement>(null);
  const mapRoot = useRef<HTMLDivElement>(null);
  const entryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusFrame = useRef<number | null>(null);
  useEffect(() => () => {
    if (entryTimer.current) clearTimeout(entryTimer.current);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
  }, []);
  const [dragging, setDragging] = useState(false);
  const { stageRef, viewport, mapView, setMapView, clampView, inertiaFrame } = useIslandCamera(12);
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    lastCenter: { x: number; y: number };
    lastDistance?: number;
    lastTime: number;
    velocityX: number;
    velocityY: number;
  } | null>(null);
  const island = workspaceIsland(world.region);
  const fitWidth = viewport.surfaceWidth ? Math.min(1150, viewport.width / viewport.surfaceWidth * 1500 * .82) : 1150;
  const fitHeight = viewport.surfaceHeight ? Math.min(750, viewport.height / viewport.surfaceHeight * 1000 * .78) : 750;
  const nodes = useMemo(() => {
    const locations = layoutWorldLocations(world.locations);
    const slots = island ? islandSceneSlots(island.id, locations.length, fitWidth, fitHeight) : [];
    return locations.map((node, index) => ({ ...node, point: slots[index] ?? node.point }));
  }, [world.locations, island, fitWidth, fitHeight]);
  const visibleLocations = world.locations.filter((location) => {
    const query = directoryQuery.trim().toLowerCase();
    return (kindFilter === "ALL" || location.kind === kindFilter) && (!query || [location.displayName, location.serviceZone, ...location.crops.map((crop) => crop.cropType)].some((value) => value.toLowerCase().includes(query)));
  });
  const visibleZoneGroups = [...visibleLocations.reduce((groups, location) => {
    groups.set(location.serviceZone, [...(groups.get(location.serviceZone) ?? []), location]);
    return groups;
  }, new Map<string, WorldMapLocation[]>()).entries()].sort(([left], [right]) => left.localeCompare(right));
  const activeRequests = world.locations.reduce((total, location) => total + location.opportunities.length, 0);
  const visibleHotelCount = world.locations.filter((location) => location.kind === "HOTEL").length;
  const nodeByFarmId = new Map(nodes.flatMap((node) => node.members.map((member) => [member.locationId, node] as const)));
  const routeDepotPoint = useMemo(() => island && mission ? islandSceneSlots(island.id, nodes.length + 1, fitWidth, fitHeight).at(-1) ?? depotPoint : depotPoint, [island, mission, nodes.length, fitWidth, fitHeight]);
  const routePoints = mission ? [routeDepotPoint, ...mission.stops.map((stop, index) => {
    if (stop.farmId && nodeByFarmId.has(stop.farmId)) return nodeByFarmId.get(stop.farmId)!.point;
    const hotelNode = nodes.find((node) => node.kind === "HOTEL" && node.members.some((member) => member.displayName === stop.displayName));
    return hotelNode?.point ?? worldSlots[(index + 5) % worldSlots.length]!;
  })] : [];
  const gameMarkers: IslandMarker[] = [
    ...(mission ? [{ kind: "DEPOT" as const, label: "Driver depot", point: routeDepotPoint, width: island ? propertyWidthOnIsland(island.id, "FARM", viewport.surfaceWidth || 1000, fitWidth, fitHeight) : 2, sequence: 0, state: "DEPOT" as const, variant: 0 }] : []),
    ...nodes.map((node, index) => ({
      kind: node.kind === "FARM" ? "PICKUP" as const : "DROPOFF" as const,
      label: node.label,
      point: node.point,
      sequence: index + 100,
      state: worldMarkerState(node),
      variant: index % 3,
      width: island ? propertyWidthOnIsland(island.id, node.kind, viewport.surfaceWidth || 1000, fitWidth, fitHeight) : 2,
    })),
  ];
  const selectedNodeIndex = nodes.findIndex((node) => node.id === selectedNodeId);
  const routeFocusIndex = mission?.stops
    .slice(Math.min(mission.currentStopSequence, mission.stops.length - 1))
    .map((stop) => nodes.findIndex((node) => node.members.some((member) => (
      stop.farmId ? member.locationId === stop.farmId : member.displayName === stop.displayName
    ))))
    .find((index) => index >= 0) ?? -1;
  const selectedSequence = selectedNodeIndex >= 0 ? selectedNodeIndex + 100 : routeFocusIndex >= 0 ? routeFocusIndex + 100 : -1;
  const moving = mission?.status === "IN_TRANSIT" && mission.currentStopSequence < mission.stops.length;
  const worldStyle = { "--map-zoom": mapView.zoom, transform: `translate3d(${mapView.x}px, ${mapView.y}px, 0) scale(${mapView.zoom})` } as CSSProperties;

  function cancelEntry() {
    if (entryTimer.current) clearTimeout(entryTimer.current);
    entryTimer.current = null;
    setEnteringPlace(false);
  }

  function resetView() {
    cancelEntry();
    setSelectedNodeId(undefined);
    setMapView({ x: 0, y: 0, zoom: 1 });
  }

  function openLocation(location: WorldMapLocation, nodeId?: string) {
    cancelEntry();
    const node = nodes.find(node => node.id === nodeId || node.members.some(member => member.locationId === location.locationId));
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedNodeId(node?.id);
    setDirectoryOpen(false);
    if (inertiaFrame.current !== null) cancelAnimationFrame(inertiaFrame.current);
    inertiaFrame.current = null;
    revealStarted.current = false;
    setPlaceReady(false);
    setEnteringPlace(true);
    setSelectedLocation(location);
  }

  function revealPlace() {
    if (revealStarted.current || !selectedLocation) return;
    revealStarted.current = true;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const node = nodes.find(node => node.members.some(member => member.locationId === selectedLocation.locationId));
    // A small camera move stays within the bitmap's useful detail. The decoded
    // property scene fades over it immediately, rather than exposing a deep crop.
    if (node && !reducedMotion) setMapView(focusIslandCamera(node.point, viewport, Math.min(12, mapView.zoom * 1.18)));
    // Establish the transparent layer before a cached image can reveal it.
    void sceneLayer.current?.getBoundingClientRect();
    setPlaceReady(true);
    onSceneChange?.(true);
    const finish = () => {
      setEnteringPlace(false);
      entryTimer.current = null;
      sceneLayer.current?.querySelector<HTMLButtonElement>(".world-back-button")?.focus({ preventScroll: true });
    };
    if (reducedMotion) finish();
    else entryTimer.current = setTimeout(finish, 500);
  }

  function closeLocation() {
    cancelEntry();
    setPlaceReady(false);
    setMapView({ x: 0, y: 0, zoom: 1 });
    const finish = () => {
      setSelectedLocation(undefined);
      setSelectedNodeId(undefined);
      onSceneChange?.(false);
      entryTimer.current = null;
      if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => {
        const place = Array.from(mapRoot.current?.querySelectorAll<HTMLButtonElement>("[data-world-node]") ?? []).find(button => button.dataset.worldNode === selectedNodeId);
        (returnFocus.current?.isConnected ? returnFocus.current : place)?.focus({ preventScroll: true });
        focusFrame.current = null;
      });
    };
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) finish();
    else entryTimer.current = setTimeout(finish, 420);
  }

  function onMapKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Escape" && enteringPlace) { event.preventDefault(); resetView(); return; }
    const movement = { ArrowLeft: [28, 0], ArrowRight: [-28, 0], ArrowUp: [0, 28], ArrowDown: [0, -28] }[event.key];
    if (!movement) return;
    event.preventDefault();
    setMapView((current) => clampView(current.x + movement[0]!, current.y + movement[1]!, current.zoom));
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

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    if (enteringPlace) resetView();
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

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const currentGesture = gesture.current;
    if (!currentGesture?.pointers.has(event.pointerId)) return;
    currentGesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const center = pointerCenter(currentGesture.pointers);
    const distance = pointerDistance(currentGesture.pointers);
    const deltaX = center.x - currentGesture.lastCenter.x;
    const deltaY = center.y - currentGesture.lastCenter.y;
    const elapsed = Math.max(8, event.timeStamp - currentGesture.lastTime);

    setMapView((current) => clampView(
      current.x + deltaX,
      current.y + deltaY,
      current.zoom * (distance && currentGesture.lastDistance ? distance / currentGesture.lastDistance : 1),
    ));
    currentGesture.velocityX = deltaX * 16 / elapsed;
    currentGesture.velocityY = deltaY * 16 / elapsed;
    currentGesture.lastCenter = center;
    currentGesture.lastDistance = distance;
    currentGesture.lastTime = event.timeStamp;
  }

  function stopPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const currentGesture = gesture.current;
    if (!currentGesture?.pointers.has(event.pointerId)) return;
    currentGesture.pointers.delete(event.pointerId);
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
      setMapView((current) => clampView(current.x + velocityX, current.y + velocityY, current.zoom));
      inertiaFrame.current = requestAnimationFrame(glide);
    };
    if (Math.abs(velocityX) >= 0.2 || Math.abs(velocityY) >= 0.2) inertiaFrame.current = requestAnimationFrame(glide);
  }

  return (
    <div ref={mapRoot} className="open-world-shell" onKeyDown={event => { if (event.key === "Escape" && selectedLocation) { event.preventDefault(); closeLocation(); } }}>
      <div
        ref={stageRef}
        inert={Boolean(selectedLocation)}
        aria-hidden={Boolean(selectedLocation && placeReady)}
        className={`island-stage open-world-stage ${enteringPlace ? "is-entering-place is-camera-moving" : ""} ${dragging ? "is-dragging" : ""}`}
        tabIndex={0}
        aria-label={`${world.region} places map`}
        data-camera-mode={enteringPlace ? "entering-place" : "island"}
        aria-busy={enteringPlace}
        onWheelCapture={event => { if (enteringPlace) event.stopPropagation(); }}
        onKeyDown={onMapKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
      >
        <div className="world-pan-layer" style={worldStyle} data-zoom={mapView.zoom.toFixed(1)}>
          <div className={`world-scene-surface open-world-surface ${rendererReady ? "is-game-ready" : ""}`}>
            {island ? <IslandLandscape islandId={island.id} fitWidth={fitWidth} fitHeight={fitHeight} /> : <Image className="island-art" src="/art/saint-lucia-terrain-v1.webp" alt="" fill sizes="100vw" priority draggable={false} />}
            <IslandGameCanvas
              activeSegment={mission?.status === "DELIVERED" ? Math.max(0, routePoints.length - 2) : mission?.currentStopSequence ?? 0}
              delivered={mission?.status === "DELIVERED"}
              markers={gameMarkers}
              moving={Boolean(moving)}
              onReady={() => setRendererReady(true)}
              points={routePoints}
              selectedStop={selectedSequence}
              showAllLabels={false}
              externalLabels
              showNetwork={false}
              vehicleWidth={island ? propertyWidthOnIsland(island.id, "FARM", viewport.surfaceWidth || 1000, fitWidth, fitHeight) / 6 : 1}
            />
            {nodes.map((node, index) => (
              <button
                type="button"
                className={`world-location-hit is-${node.kind.toLowerCase()} is-${worldMarkerState(node).toLowerCase().replaceAll("_", "-")} ${selectedNodeId === node.id ? "is-selected" : ""} ${routeFocusIndex === index ? "is-route-focus" : ""}`}
                style={{ left: `${node.point.x * 100}%`, top: `${node.point.y * 100}%`, "--marker-delay": `${index * -.13}s` } as CSSProperties}
                aria-current={routeFocusIndex === index ? "location" : undefined}
                data-world-state={worldMarkerState(node)}
                data-world-node={node.id}
                data-building-width={gameMarkers.find(marker => marker.sequence === index + 100)?.width}
                aria-label={node.members.length === 1 ? `${node.kind === "FARM" ? "Farm" : "Hotel"}: ${node.label}. ${locationHint(node.members[0]!)}` : `Open ${node.label}`}
                onClick={() => node.members.length === 1 ? openLocation(node.members[0]!, node.id) : (setDirectoryQuery(node.members[0]!.serviceZone), setKindFilter(node.kind), setDirectoryOpen(true), setSelectedNodeId(node.id))}
                onPointerEnter={() => { if (!enteringPlace) setSelectedNodeId(node.id); }}
                onPointerLeave={() => { if (!enteringPlace) setSelectedNodeId(undefined); }}
                onFocus={() => setSelectedNodeId(node.id)}
                onBlur={() => { if (!enteringPlace) setSelectedNodeId(undefined); }}
                key={node.id}
              >
                <span className="world-place-pin" aria-hidden="true" />
                <span className="world-place-name">{node.label}</span>
                <span className="world-location-fallback">{node.kind === "FARM" ? <Sprout size={19} /> : <Building2 size={19} />}<b>{node.members.length > 1 ? node.members.length : node.label}</b></span>
              </button>
            ))}
          </div>
        </div>

        <MapControls zoom={mapView.zoom} max={12} onZoom={zoom => { cancelEntry(); setMapView(current => ({ ...current, zoom })); }} onReset={resetView} />
        {!nodes.length && <div className="island-empty-places"><MapPin size={18} /><span>No places yet</span></div>}
        <button className="world-directory-button" type="button" aria-label={`${world.locations.length} island places. Browse farms and hotels`} aria-expanded={directoryOpen} onClick={() => setDirectoryOpen((open) => !open)}><ListFilter size={17} /><span>Places</span><b>{world.locations.length}</b></button>
        {!mission && activeRequests > 0 && (
          <button className="world-demand-signal" type="button" onClick={() => { setDirectoryQuery(""); setKindFilter("HOTEL"); setDirectoryOpen(true); }}>
            <Store size={21} />
            <span><small>Live hotel boards</small><strong>{activeRequests} open request{activeRequests === 1 ? "" : "s"} across {visibleHotelCount} hotel{visibleHotelCount === 1 ? "" : "s"}</strong></span>
            <ArrowRight size={17} />
          </button>
        )}
        {mission && (
          <div className="world-route-ribbon">
            <Truck size={20} />
            <span><small>Route layer</small><strong>{mission.quantity.value} kg {titleCase(mission.cropType)} → {mission.buyerName}</strong></span>
            <Badge>{mission.status}</Badge>
            <Link href={role === "TRANSPORTER" ? `/missions/${mission.missionId}` : `/orders/${mission.orderId}`} aria-label="Open selected route"><ArrowRight size={17} /></Link>
            {onClearRoute && <button type="button" aria-label="Hide selected route" onClick={onClearRoute}><X size={16} /></button>}
          </div>
        )}
      </div>

      {directoryOpen && (
        <aside className="world-directory" aria-label="Island places">
          <div className="world-directory-heading"><span><MapPin size={17} /><strong>Island places</strong></span><button type="button" aria-label="Close places" onClick={() => setDirectoryOpen(false)}><X size={18} /></button></div>
          <label className="map-route-search"><Search size={16} /><span className="sr-only">Search island places</span><input value={directoryQuery} onChange={(event) => setDirectoryQuery(event.target.value)} placeholder="Search place, zone, or crop" /></label>
          <div className="world-kind-filter" aria-label="Filter island places">
            {(["ALL", "FARM", "HOTEL"] as const).map((kind) => <button type="button" className={kindFilter === kind ? "is-selected" : ""} aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kind)} key={kind}>{kind === "ALL" ? "All" : kind === "FARM" ? "Farms" : "Hotels"}</button>)}
          </div>
          <div className="world-directory-list">
            {visibleZoneGroups.map(([zone, locations]) => (
              <section className="world-directory-zone" aria-label={`${zone} places`} key={zone}>
                <h3><MapPin size={13} />{zone}<b>{locations.length}</b></h3>
                {locations.map((location) => <button type="button" onClick={() => openLocation(location)} key={location.locationId}><span className={`world-place-kind is-${location.kind.toLowerCase()}`}>{location.kind === "FARM" ? <Sprout size={17} /> : <Hotel size={17} />}</span><span><strong>{location.displayName}</strong><small>{locationHint(location)}</small></span>{location.access !== "LOGISTICS" && <Check size={16} />}</button>)}
              </section>
            ))}
            {!visibleLocations.length && <EmptyState title="No places match" />}
          </div>
        </aside>
      )}
      {selectedLocation && <div ref={sceneLayer} className={`world-place-layer ${placeReady ? "is-visible" : ""}`} aria-hidden={!placeReady} inert={!placeReady}>
        {selectedLocation.kind === "FARM"
          ? <WorldFarmScene location={selectedLocation} onBack={closeLocation} onArtReady={revealPlace} />
          : <WorldHotelScene location={selectedLocation} world={world} role={role} onBack={closeLocation} onArtReady={revealPlace} />}
      </div>}
    </div>
  );
}
