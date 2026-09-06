export interface IslandCamera { x: number; y: number; zoom: number }
export interface IslandViewport { width: number; height: number; surfaceWidth: number; surfaceHeight: number }

/** Keep the painted surface covering the viewport at every camera position. */
export function clampIslandCamera(camera: IslandCamera, viewport: IslandViewport, maxZoom = 3): IslandCamera {
  const zoom = Math.max(1, Math.min(maxZoom, camera.zoom));
  const horizontal = Math.max(0, (viewport.surfaceWidth * zoom - viewport.width) / 2 - 1);
  const vertical = Math.max(0, (viewport.surfaceHeight * zoom - viewport.height) / 2 - 1);
  return { x: Math.max(-horizontal, Math.min(horizontal, camera.x)), y: Math.max(-vertical, Math.min(vertical, camera.y)), zoom };
}

/** Center a map location during the transition to its property-level scene. */
export function focusIslandCamera(point: { x: number; y: number }, viewport: IslandViewport, zoom: number): IslandCamera {
  return clampIslandCamera({ x: (.5 - point.x) * viewport.surfaceWidth * zoom, y: (.5 - point.y) * viewport.surfaceHeight * zoom, zoom }, viewport, zoom);
}
