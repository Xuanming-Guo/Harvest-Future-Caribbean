"use client";

import type { ApiSchema } from "@harvest/shared";
import { CloudRain, Hotel, Sprout, Truck } from "lucide-react";
import { useState } from "react";

import { Badge } from "./ui";

type World = ApiSchema<"ObservableWorld">;

const project = (latitude: number, longitude: number) => ({
  x: 12 + ((longitude + 61.08) / 0.24) * 76,
  y: 8 + ((14.12 - latitude) / 0.44) * 84,
});

const roleIcon = { FARMER: Sprout, BUYER: Hotel, TRANSPORTER: Truck } as const;

export function WorldMap({ world }: { world: World }) {
  const [selected, setSelected] = useState<World["actors"][number] | null>(null);
  return <div className="world-map">
    <svg viewBox="0 0 100 120" role="img" aria-label="Observable Saint Lucia simulation map">
      <defs><linearGradient id="island" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#356d52" /><stop offset="1" stopColor="#173e31" /></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="1.8" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <path className="island" d="M54 3 C67 12 63 24 72 34 C80 46 73 58 78 68 C83 82 69 94 64 112 C56 119 47 110 44 98 C39 86 26 80 30 67 C35 54 27 44 36 32 C43 23 38 12 54 3Z" fill="url(#island)" />
      {world.routes.map((route) => <polyline key={route.missionId} className={`map-route route-${route.status.toLowerCase()}`} points={route.path.map((point) => { const p = project(point.latitude, point.longitude); return `${p.x},${p.y}`; }).join(" ")} />)}
      {world.actors.map((actor) => { const point = project(actor.position.latitude, actor.position.longitude); const Icon = roleIcon[actor.role as keyof typeof roleIcon] ?? Sprout; return <g key={actor.actorId} className={`map-actor actor-${actor.role.toLowerCase()}`} transform={`translate(${point.x} ${point.y})`} onClick={() => setSelected(actor)} role="button" tabIndex={0}><circle r="5" /><foreignObject x="-3" y="-3" width="6" height="6"><Icon size={6} /></foreignObject></g>; })}
      {world.disruptions.map((item, index) => <g key={item.eventId} className="map-disruption" transform={`translate(${65 - index * 9} ${58 + index * 5})`}><circle r="6" /><foreignObject x="-3" y="-3" width="6" height="6"><CloudRain size={6} /></foreignObject></g>)}
    </svg>
    <div className="map-legend"><span><i className="dot crop" />Farm</span><span><i className="dot demand" />Buyer</span><span><i className="dot delivery" />Transport</span><span><i className="dot exception" />Disruption</span></div>
    {selected && <div className="map-detail"><Badge>{selected.role}</Badge><strong>{selected.activity}</strong><small>{selected.position.latitude.toFixed(3)}, {selected.position.longitude.toFixed(3)}</small><button onClick={() => setSelected(null)}>Close</button></div>}
  </div>;
}
