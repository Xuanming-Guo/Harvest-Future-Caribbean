"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { clampIslandCamera, type IslandCamera, type IslandViewport } from "@/lib/island-camera";

export function useIslandCamera(maxZoom = 3) {
  const [stage, stageRef] = useState<HTMLDivElement | null>(null);
  const [mapView, updateView] = useState<IslandCamera>({ x: 0, y: 0, zoom: 1 });
  const dimensions = useRef<IslandViewport>({ width: 0, height: 0, surfaceWidth: 0, surfaceHeight: 0 });
  const [viewport, setViewport] = useState<IslandViewport>(dimensions.current);
  const inertiaFrame = useRef<number | null>(null);
  const clampView = useCallback((x: number, y: number, zoom: number) => clampIslandCamera({ x, y, zoom }, dimensions.current, maxZoom), [maxZoom]);
  const setMapView = useCallback((action: SetStateAction<IslandCamera>) => {
    updateView(previous => clampIslandCamera(typeof action === "function" ? action(previous) : action, dimensions.current, maxZoom));
  }, [maxZoom]);

  useEffect(() => {
    if (!stage) return;
    const measure = () => {
      const surface = stage.querySelector<HTMLElement>(".world-scene-surface");
      if (!surface) return;
      const bounds = stage.getBoundingClientRect();
      const css = getComputedStyle(surface);
      dimensions.current = { width: bounds.width, height: bounds.height, surfaceWidth: parseFloat(css.width) || bounds.width, surfaceHeight: parseFloat(css.height) || bounds.height };
      setViewport(previous => Object.keys(previous).every(key => previous[key as keyof IslandViewport] === dimensions.current[key as keyof IslandViewport]) ? previous : dimensions.current);
      setMapView(previous => previous);
    };
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest("button, input, select, textarea")) return;
      event.preventDefault();
      if (inertiaFrame.current !== null) cancelAnimationFrame(inertiaFrame.current);
      inertiaFrame.current = null;
      const bounds = stage.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      setMapView(previous => {
        const zoom = Math.max(1, Math.min(maxZoom, previous.zoom * Math.exp(-delta * .001)));
        const x = event.clientX - bounds.left - bounds.width / 2;
        const y = event.clientY - bounds.top - bounds.height / 2;
        return { x: x - (x - previous.x) * zoom / previous.zoom, y: y - (y - previous.y) * zoom / previous.zoom, zoom };
      });
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.target !== stage || !["+", "=", "-", "0"].includes(event.key)) return;
      event.preventDefault();
      setMapView(previous => event.key === "0" ? { x: 0, y: 0, zoom: 1 } : { ...previous, zoom: previous.zoom + (event.key === "-" ? -.2 : .2) });
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(stage);
    stage.addEventListener("wheel", wheel, { passive: false });
    stage.addEventListener("keydown", keyboard);
    return () => { observer?.disconnect(); stage.removeEventListener("wheel", wheel); stage.removeEventListener("keydown", keyboard); };
  }, [stage, setMapView, maxZoom]);

  useEffect(() => () => { if (inertiaFrame.current !== null) cancelAnimationFrame(inertiaFrame.current); }, []);
  return { stageRef, viewport, mapView, setMapView, clampView, inertiaFrame };
}
