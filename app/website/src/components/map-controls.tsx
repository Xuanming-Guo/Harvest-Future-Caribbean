"use client";
import { Maximize2, Minus, Plus } from "lucide-react";
export function MapControls({ zoom, min = 1, max = 3, onZoom, onReset, resetLabel = "Reset map view" }: { zoom: number; min?: number; max?: number; onZoom: (zoom: number) => void; onReset: () => void; resetLabel?: string }) {
  return <div className="harvest-map-controls" role="group" aria-label="Map controls">
    <button type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= min + .001} onClick={() => onZoom(Math.max(min, zoom - .2))}><Minus size={17} /></button>
    <output aria-label="Map zoom">{Math.round(zoom * 100)}%</output>
    <button type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= max - .001} onClick={() => onZoom(Math.min(max, zoom + .2))}><Plus size={17} /></button>
    <span className="map-control-divider" />
    <button type="button" aria-label={resetLabel} title="Fit island" onClick={onReset}><Maximize2 size={16} /></button>
  </div>;
}
