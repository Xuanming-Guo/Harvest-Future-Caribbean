"use client";

import type { ApiSchema } from "@harvest/shared";
import { ArrowLeft, ArrowRight, Building2, Check, Hotel, ListFilter, MapPin, Maximize2, Minus, Move, PackageCheck, Plus, Search, Sprout, Store, Truck, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { CropProgressPlot, type DeliveryMissionView } from "@/components/delivery-world";
import { IslandGameCanvas, type IslandPoint } from "@/components/island-game-canvas";
import { Badge, EmptyState } from "@/components/ui";
import { titleCase } from "@/lib/format";

export type WorldMapView = ApiSchema<"WorldMapView">;
export type WorldMapLocation = ApiSchema<"WorldMapLocation">;
type ProductRole = "FARMER" | "BUYER" | "TRANSPORTER" | "COORDINATOR";

type WorldNode = {
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

function WorldFarmScene({ location, onBack }: { location: WorldMapLocation; onBack: () => void }) {
  return (
    <section className="world-place-scene world-farm-scene" aria-label={`${location.displayName} farm view`}>
      <Image className="farm-scene-art" src="/art/saint-lucia-farm.png" alt="" fill sizes="100vw" priority />
      <div className="world-place-header">
        <button type="button" className="world-back-button" onClick={onBack}><ArrowLeft size={17} />Back to island</button>
        <div><span>{location.serviceZone}</span><h2>{location.displayName}</h2><small>{location.access === "CROP_PROGRESS" ? "Your live crop workspace" : location.access === "PUBLIC_SUPPLY" ? "Produce currently listed for buyers" : "Delivery location"}</small></div>
      </div>
      <div className="world-place-content">
        {location.access === "CROP_PROGRESS" && location.crops.length ? (
          <div className="crop-progress-grid world-crop-grid">
            {location.crops.map((crop) => (
              <CropProgressPlot cargo={{
                cropBatchId: crop.cropBatchId!,
                farmId: location.locationId,
                farmName: location.displayName,
                cropType: crop.cropType,
                cropStatus: crop.status,
                quantity: crop.quantity ?? { value: 0, unit: "kg" },
              }} quantityLabel="available to promise" key={crop.cropBatchId ?? crop.cropType} />
            ))}
          </div>
        ) : location.crops.length ? (
          <div className="world-supply-board">
            <h3>Available from this farm</h3>
            {location.crops.map((crop) => <div className="world-supply-ticket" key={crop.cropBatchId ?? crop.cropType}><Sprout size={20} /><span><strong>{titleCase(crop.cropType)}</strong><small>{crop.quantity?.value ?? "—"} kg listed</small></span></div>)}
            <Link className="button" href="/marketplace">Browse marketplace<ArrowRight size={16} /></Link>
          </div>
        ) : (
          <div className="world-private-place"><Sprout size={30} /><h3>Farm stop</h3><p>Crop progress stays private unless this farm is yours or its produce is committed to your order.</p></div>
        )}
      </div>
    </section>
  );
}

function WorldHotelScene({ location, world, role, onBack }: { location: WorldMapLocation; world: WorldMapView; role: ProductRole; onBack: () => void }) {
  return (
    <section className="world-place-scene world-hotel-scene" aria-label={`${location.displayName} hotel view`}>
      <div className="hotel-scene-sky" aria-hidden="true"><span /><span /><span /></div>
      <div className="hotel-scene-building" aria-hidden="true"><i /><b>HOTEL</b><span /><span /><span /><span /></div>
      <div className="world-place-header">
        <button type="button" className="world-back-button" onClick={onBack}><ArrowLeft size={17} />Back to island</button>
        <div><span>{location.serviceZone}</span><h2>{location.displayName}</h2><small>{location.access === "BUYER_DEMAND" ? "Buyer requests you can help fill" : "Hotel delivery destination"}</small></div>
      </div>
      <div className="world-place-content hotel-order-board">
        <div className="hotel-order-board-title"><Store size={23} /><span><small>Order board</small><h3>{location.opportunities.length ? "Produce wanted" : "Hotel deliveries"}</h3></span></div>
        {location.opportunities.length ? location.opportunities.map((opportunity, index) => {
          const matchingCrop = world.locations.flatMap((item) => item.kind === "FARM" && item.access === "CROP_PROGRESS" ? item.crops : []).find((crop) => crop.cropType === opportunity.cropType && crop.cropBatchId);
          return (
            <article className={`hotel-order-ticket ticket-${index % 3}`} key={opportunity.opportunityId}>
              <span className="ticket-pin" aria-hidden="true" />
              <Badge>{opportunity.status}</Badge>
              <h4>{opportunity.quantity.value} kg {titleCase(opportunity.cropType)}</h4>
              <p>Needed {dueLabel(opportunity.neededBy)}</p>
              {opportunity.maxUnitPrice && <strong>Up to {opportunity.maxUnitPrice.currency} {opportunity.maxUnitPrice.amount}/kg</strong>}
              {role === "FARMER" && matchingCrop?.cropBatchId && <Link className="button" href={`/crops/${matchingCrop.cropBatchId}`}>Open crop to offer<ArrowRight size={15} /></Link>}
            </article>
          );
        }) : location.access === "OWN_ORDERS" ? (
          <div className="world-private-place"><PackageCheck size={30} /><h3>Your hotel journey board</h3><p>Open an order to follow its farms and delivery route.</p><Link className="button" href="/orders">View orders<ArrowRight size={16} /></Link></div>
        ) : (
          <div className="world-private-place"><Hotel size={30} /><h3>No open requests here</h3><p>This hotel is visible because it belongs to one of your accessible delivery routes.</p></div>
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
  const [dragging, setDragging] = useState(false);
  const [mapView, setMapView] = useState({ x: 0, y: 0, zoom: 1 });
  const gesture = useRef<{ pointerId: number; x: number; y: number } | undefined>(undefined);
  const nodes = useMemo(() => layoutWorldLocations(world.locations), [world.locations]);
  const visibleLocations = world.locations.filter((location) => {
    const query = directoryQuery.trim().toLowerCase();
    return (kindFilter === "ALL" || location.kind === kindFilter) && (!query || [location.displayName, location.serviceZone, ...location.crops.map((crop) => crop.cropType)].some((value) => value.toLowerCase().includes(query)));
  });
  const nodeByFarmId = new Map(nodes.flatMap((node) => node.members.map((member) => [member.locationId, node] as const)));
  const routePoints = mission ? [depotPoint, ...mission.stops.map((stop, index) => {
    if (stop.farmId && nodeByFarmId.has(stop.farmId)) return nodeByFarmId.get(stop.farmId)!.point;
    const hotelNode = nodes.find((node) => node.kind === "HOTEL" && node.members.some((member) => member.displayName === stop.displayName));
    return hotelNode?.point ?? worldSlots[(index + 5) % worldSlots.length]!;
  })] : [];
  const gameMarkers = [
    ...(mission ? [{ kind: "DEPOT" as const, label: "Driver depot", point: depotPoint, sequence: 0 }] : []),
    ...nodes.map((node, index) => ({ kind: node.kind === "FARM" ? "PICKUP" as const : "DROPOFF" as const, label: node.label, point: node.point, sequence: index + 100 })),
  ];
  const selectedNodeIndex = nodes.findIndex((node) => node.id === selectedNodeId);
  const selectedSequence = selectedNodeIndex < 0 ? -1 : selectedNodeIndex + 100;
  const moving = mission?.status === "IN_TRANSIT" && mission.currentStopSequence < mission.stops.length;
  const worldStyle = { transform: `translate3d(${mapView.x}px, ${mapView.y}px, 0) scale(${mapView.zoom})` } as CSSProperties;

  function clampView(x: number, y: number, zoom: number) {
    const boundedZoom = Math.min(2, Math.max(1, zoom));
    const horizontal = 220 + (boundedZoom - 1) * 210;
    const vertical = 140 + (boundedZoom - 1) * 150;
    return { x: Math.max(-horizontal, Math.min(horizontal, x)), y: Math.max(-vertical, Math.min(vertical, y)), zoom: boundedZoom };
  }

  function openLocation(location: WorldMapLocation, nodeId?: string) {
    setSelectedNodeId(nodeId ?? nodes.find((node) => node.members.some((member) => member.locationId === location.locationId))?.id);
    setSelectedLocation(location);
    setDirectoryOpen(false);
    onSceneChange?.(true);
  }

  function closeLocation() {
    setSelectedLocation(undefined);
    onSceneChange?.(false);
  }

  function onMapKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const movement = { ArrowLeft: [28, 0], ArrowRight: [-28, 0], ArrowUp: [0, 28], ArrowDown: [0, -28] }[event.key];
    if (!movement) return;
    event.preventDefault();
    setMapView((current) => clampView(current.x + movement[0]!, current.y + movement[1]!, current.zoom));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!gesture.current || gesture.current.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.current.x;
    const deltaY = event.clientY - gesture.current.y;
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setMapView((current) => clampView(current.x + deltaX, current.y + deltaY, current.zoom));
  }

  function stopPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = undefined;
    setDragging(false);
  }

  if (selectedLocation) return selectedLocation.kind === "FARM"
    ? <WorldFarmScene location={selectedLocation} onBack={closeLocation} />
    : <WorldHotelScene location={selectedLocation} world={world} role={role} onBack={closeLocation} />;

  return (
    <div className="open-world-shell">
      <div
        className={`island-stage open-world-stage ${dragging ? "is-dragging" : ""}`}
        tabIndex={0}
        aria-label="Interactive Saint Lucia world map. Drag to move, use arrow keys, or activate a farm or hotel."
        onKeyDown={onMapKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={stopPointer}
        onPointerCancel={stopPointer}
      >
        <div className="world-pan-layer" style={worldStyle} data-zoom={mapView.zoom.toFixed(1)}>
          <div className={`world-scene-surface open-world-surface ${rendererReady ? "is-game-ready" : ""}`}>
            <Image className="island-art" src="/art/saint-lucia-delivery-island.png" alt="" fill sizes="100vw" priority draggable={false} />
            <IslandGameCanvas
              activeSegment={mission?.status === "DELIVERED" ? Math.max(0, routePoints.length - 2) : mission?.currentStopSequence ?? 0}
              delivered={mission?.status === "DELIVERED"}
              markers={gameMarkers}
              moving={Boolean(moving)}
              onReady={() => setRendererReady(true)}
              points={routePoints}
              selectedStop={selectedSequence}
              showAllLabels
            />
            {nodes.map((node, index) => (
              <button
                type="button"
                className={`world-location-hit is-${node.kind.toLowerCase()} ${selectedNodeId === node.id ? "is-selected" : ""}`}
                style={{ left: `${node.point.x * 100}%`, top: `${node.point.y * 100}%`, "--marker-delay": `${index * -.13}s` } as CSSProperties}
                aria-label={node.members.length === 1 ? `${node.kind === "FARM" ? "Farm" : "Hotel"}: ${node.label}. ${locationHint(node.members[0]!)}` : `Open ${node.label}`}
                onClick={() => node.members.length === 1 ? openLocation(node.members[0]!, node.id) : (setDirectoryQuery(node.members[0]!.serviceZone), setKindFilter(node.kind), setDirectoryOpen(true), setSelectedNodeId(node.id))}
                key={node.id}
              >
                <span className="world-location-fallback">{node.kind === "FARM" ? <Sprout size={19} /> : <Building2 size={19} />}<b>{node.members.length > 1 ? node.members.length : node.label}</b></span>
              </button>
            ))}
          </div>
        </div>

        <div className="world-map-controls" aria-label="Map controls">
          <button type="button" onClick={() => setMapView((current) => clampView(current.x, current.y, current.zoom + .2))} aria-label="Zoom in"><Plus size={18} /></button>
          <button type="button" onClick={() => setMapView((current) => clampView(current.x, current.y, current.zoom - .2))} aria-label="Zoom out" disabled={mapView.zoom === 1}><Minus size={18} /></button>
          <button type="button" onClick={() => setMapView({ x: 0, y: 0, zoom: 1 })} aria-label="Reset map view"><Maximize2 size={17} /></button>
        </div>
        <button className="world-directory-button" type="button" aria-label={`${world.locations.length} island places. Browse farms and hotels`} aria-expanded={directoryOpen} onClick={() => setDirectoryOpen((open) => !open)}><ListFilter size={17} /><span>Places</span><b>{world.locations.length}</b></button>
        <div className="world-map-hint"><Move size={15} /><span>Living island · drag to explore</span></div>
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
            {visibleLocations.map((location) => <button type="button" onClick={() => openLocation(location)} key={location.locationId}><span className={`world-place-kind is-${location.kind.toLowerCase()}`}>{location.kind === "FARM" ? <Sprout size={17} /> : <Hotel size={17} />}</span><span><strong>{location.displayName}</strong><small>{location.serviceZone} · {locationHint(location)}</small></span>{location.access !== "LOGISTICS" && <Check size={16} />}</button>)}
            {!visibleLocations.length && <EmptyState title="No places match" detail="Try another place, zone, or crop." />}
          </div>
        </aside>
      )}
    </div>
  );
}
