"use client";

import { useEffect, useRef, useState } from "react";

export type IslandPoint = { x: number; y: number };
export type IslandMarkerState = "PLANNED" | "GROWING" | "HARVEST_READY" | "HARVESTED" | "CLOSED" | "OPEN" | "QUIET" | "DEPOT";
export type IslandMarker = {
  kind: "DEPOT" | "PICKUP" | "DROPOFF";
  label: string;
  point: IslandPoint;
  sequence: number;
  state: IslandMarkerState;
  variant: number;
  width?: number;
};

type IslandGameCanvasProps = {
  activeSegment: number;
  delivered: boolean;
  markers: IslandMarker[];
  moving: boolean;
  onReady?: () => void;
  points: IslandPoint[];
  selectedStop: number;
  showAllLabels?: boolean;
  externalLabels?: boolean;
  showNetwork?: boolean;
  vehicleWidth?: number;
};

type Curve = {
  start: IslandPoint;
  controlA: IslandPoint;
  controlB: IslandPoint;
  end: IslandPoint;
};

export type IslandRoadSegment = { start: IslandPoint; end: IslandPoint };

const farmAssetPaths = [
  "/art/farm-location-game.webp",
  "/art/farm-location-dasheen.webp",
  "/art/farm-location-orchard.webp",
];
const hotelAssetPaths = [
  "/art/hotel-location-game.webp",
  "/art/hotel-location-boutique.webp",
  "/art/hotel-location-eco.webp",
];

export function buildIslandRoadNetwork(markers: IslandMarker[]): IslandRoadSegment[] {
  if (markers.length < 2) return [];
  const connected = new Set<number>([Math.max(0, markers.findIndex((marker) => marker.kind === "DEPOT"))]);
  const segments: IslandRoadSegment[] = [];

  while (connected.size < markers.length) {
    let shortest: { from: number; to: number; distance: number } | undefined;
    for (const from of connected) {
      for (let to = 0; to < markers.length; to += 1) {
        if (connected.has(to)) continue;
        const distance = Math.hypot(
          markers[from]!.point.x - markers[to]!.point.x,
          markers[from]!.point.y - markers[to]!.point.y,
        );
        if (!shortest || distance < shortest.distance) shortest = { from, to, distance };
      }
    }
    if (!shortest) break;
    connected.add(shortest.to);
    segments.push({ start: markers[shortest.from]!.point, end: markers[shortest.to]!.point });
  }

  return segments;
}

function curveFor(start: IslandPoint, end: IslandPoint, index: number): Curve {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(Math.hypot(dx, dy), 0.001);
  const bend = (index % 2 ? -1 : 1) * Math.min(0.075, length * 0.2);
  const normalX = -dy / length;
  const normalY = dx / length;
  return {
    start,
    controlA: { x: start.x + dx * 0.34 + normalX * bend, y: start.y + dy * 0.34 + normalY * bend },
    controlB: { x: start.x + dx * 0.68 + normalX * bend, y: start.y + dy * 0.68 + normalY * bend },
    end,
  };
}

function curvePoint(curve: Curve, progress: number) {
  const inverse = 1 - progress;
  return {
    x: inverse ** 3 * curve.start.x + 3 * inverse ** 2 * progress * curve.controlA.x + 3 * inverse * progress ** 2 * curve.controlB.x + progress ** 3 * curve.end.x,
    y: inverse ** 3 * curve.start.y + 3 * inverse ** 2 * progress * curve.controlA.y + 3 * inverse * progress ** 2 * curve.controlB.y + progress ** 3 * curve.end.y,
  };
}

function curveDirection(curve: Curve, progress: number) {
  const before = curvePoint(curve, Math.max(0, progress - 0.01));
  const after = curvePoint(curve, Math.min(1, progress + 0.01));
  return { x: after.x - before.x, y: after.y - before.y };
}

export function IslandGameCanvas({ activeSegment, delivered, markers, moving, onReady, points, selectedStop, showAllLabels = false, externalLabels = false, showNetwork = true, vehicleWidth }: IslandGameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onReadyRef = useRef(onReady);
  const selectedStopRef = useRef(selectedStop);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pointKey = points.map((point) => `${point.x},${point.y}`).join(";");
  const markerPayload = JSON.stringify(markers);

  useEffect(() => {
    selectedStopRef.current = selectedStop;
  }, [selectedStop]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(preference.matches);
    updatePreference();
    preference.addEventListener("change", updatePreference);
    return () => preference.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "test" || !hostRef.current || !canvasRef.current) return;

    const host = hostRef.current;
    const canvas = canvasRef.current;
    let cancelled = false;
    let cleanup = () => undefined;

    void (async () => {
      const { Application, Assets, Container, Graphics, Sprite, Text } = await import("pixi.js");
      const app = new Application();
      await app.init({
        antialias: true,
        autoDensity: true,
        backgroundAlpha: 0,
        canvas,
        powerPreference: "high-performance",
        preference: ["canvas", "webgl"],
        resolution: Math.min(window.devicePixelRatio || 1, 1.75),
        resizeTo: host,
      });
      if (cancelled) {
        app.destroy(false, { children: true });
        return;
      }

      const textures = await Promise.all([
        Assets.load("/art/delivery-truck-game.webp"),
        ...farmAssetPaths.map((path) => Assets.load(path)),
        ...hotelAssetPaths.map((path) => Assets.load(path)),
      ]);
      const truckTexture = textures[0]!;
      const farmTextures = textures.slice(1, 1 + farmAssetPaths.length);
      const hotelTextures = textures.slice(1 + farmAssetPaths.length);
      if (cancelled) {
        app.destroy(false, { children: true });
        return;
      }

      const networkLayer = new Container();
      const routeLayer = new Container();
      const ambientLayer = new Container();
      const markerLayer = new Container();
      const dustLayer = new Container();
      const truckLayer = new Container();
      const celebrationLayer = new Container();
      app.stage.addChild(networkLayer, routeLayer, ambientLayer, markerLayer, dustLayer, truckLayer, celebrationLayer);

      const roadShadow = new Graphics();
      const roadEdge = new Graphics();
      const roadSurface = new Graphics();
      const roadHighlight = new Graphics();
      networkLayer.addChild(roadShadow, roadEdge, roadSurface, roadHighlight);

      const routeGlow = new Graphics();
      const routeLine = new Graphics();
      const activeTrail = new Graphics();
      routeLayer.addChild(routeGlow, activeTrail, routeLine);

      const shimmers = Array.from({ length: 11 }, (_, index) => {
        const shimmer = new Graphics().ellipse(0, 0, 13 + index % 4 * 4, 1.5).fill({ color: 0xe9ffff, alpha: 0.7 });
        ambientLayer.addChild(shimmer);
        return shimmer;
      });
      const shimmerPositions = [
        [0.08, 0.18], [0.14, 0.48], [0.06, 0.76], [0.21, 0.91], [0.52, 0.94], [0.75, 0.9],
        [0.91, 0.73], [0.94, 0.42], [0.82, 0.17], [0.63, 0.1], [0.37, 0.08],
      ];
      const birds = Array.from({ length: 3 }, (_, index) => {
        const bird = new Graphics()
          .moveTo(-8, 0)
          .quadraticCurveTo(-4, -5, 0, 0)
          .quadraticCurveTo(4, -5, 8, 0)
          .stroke({ color: 0x315e58, width: 2, alpha: 0.58 });
        bird.scale.set(0.75 + index * 0.17);
        ambientLayer.addChild(bird);
        return bird;
      });
      const fieldMotes = Array.from({ length: 9 }, (_, index) => {
        const mote = new Graphics().circle(0, 0, index % 3 === 0 ? 2.2 : 1.4).fill({ color: index % 2 ? 0xffed8d : 0xe8fff0, alpha: 0.75 });
        ambientLayer.addChild(mote);
        return mote;
      });

      const normalizedMarkers = JSON.parse(markerPayload) as IslandMarker[];
      const worldMarkers = normalizedMarkers.map((marker) => {
        const container = new Container();
        const markerColor = marker.kind === "PICKUP" ? 0x55c982 : marker.kind === "DROPOFF" ? 0xff8262 : 0xffca52;
        const isReady = marker.state === "HARVEST_READY";
        const hasDemand = marker.state === "OPEN";
        const footprintWidth = marker.kind === "DEPOT" ? 34 : marker.kind === "DROPOFF" ? 61 : 58;
        const footprint = new Graphics()
          .ellipse(4, 18, footprintWidth, marker.kind === "DEPOT" ? 14 : 19)
          .fill({ color: marker.kind === "DROPOFF" ? 0xc5a86a : 0x7cab52, alpha: 0.34 })
          .stroke({ color: marker.kind === "DROPOFF" ? 0xf1d695 : 0xb8d67c, width: 3, alpha: 0.42 })
          .ellipse(8, 23, footprintWidth * 0.78, 11)
          .fill({ color: 0x3d5633, alpha: 0.13 });
        const groundGlow = new Graphics().ellipse(0, 12, isReady || hasDemand ? 57 : 49, isReady || hasDemand ? 19 : 16).fill({ color: markerColor, alpha: 0.18 });
        const pulse = new Graphics().ellipse(0, 9, 57, 32).stroke({ color: markerColor, width: 4, alpha: 0.8 });
        const symbol = new Container();
        const accessory = new Container();
        if (marker.kind === "PICKUP") {
          const farmTexture = farmTextures[marker.variant % farmTextures.length]!;
          const farm = new Sprite(farmTexture);
          farm.anchor.set(0.5, 0.78);
          const farmScale = (119 + marker.variant * 4) / farmTexture.width;
          farm.scale.set(farmScale);
          farm.rotation = (marker.variant - 1) * 0.008;
          if (marker.state === "CLOSED") {
            farm.tint = 0xb9beaa;
            farm.alpha = 0.72;
          }
          symbol.addChild(farm);

          if (marker.state === "PLANNED") {
            [-12, 0, 12].forEach((x, index) => {
              const seedling = new Graphics()
                .moveTo(x, 7).lineTo(x, -2 - index % 2 * 2).stroke({ color: 0x3b7652, width: 2.4 })
                .ellipse(x - 3, -3 - index % 2 * 2, 4, 2.2).fill({ color: 0x73b960 })
                .ellipse(x + 3, -5 - index % 2 * 2, 4, 2.2).fill({ color: 0x58a553 });
              seedling.position.set(-4, 18);
              accessory.addChild(seedling);
            });
          }
          if (marker.state === "GROWING") {
            [-15, 0, 15].forEach((x, index) => {
              const crop = new Graphics()
                .ellipse(x - 4, 0, 7, 3.5).fill({ color: 0x4d9e4d })
                .ellipse(x + 4, -2, 7, 3.5).fill({ color: 0x71bb54 })
                .circle(x, -5 - index % 2 * 2, 4).fill({ color: 0xa4d55e });
              crop.position.set(-2, 17);
              accessory.addChild(crop);
            });
          }
          if (marker.state === "HARVESTED") {
            const crate = new Graphics()
              .roundRect(-12, -8, 24, 16, 2).fill({ color: 0xd58b3c }).stroke({ color: 0x754525, width: 2 })
              .moveTo(-10, -2).lineTo(10, -2).moveTo(-10, 4).lineTo(10, 4).stroke({ color: 0xf0b85d, width: 1.5 });
            crate.position.set(32, 12);
            accessory.addChild(crate);
          }
        } else if (marker.kind === "DROPOFF") {
          const hotelTexture = hotelTextures[marker.variant % hotelTextures.length]!;
          const hotel = new Sprite(hotelTexture);
          hotel.anchor.set(0.5, 0.78);
          const hotelScale = (122 + marker.variant * 4) / hotelTexture.width;
          hotel.scale.set(hotelScale);
          hotel.rotation = (marker.variant - 1) * 0.008;
          if (marker.state === "QUIET") hotel.tint = 0xe3e6d8;
          symbol.addChild(hotel);

          if (hasDemand) {
            const orderFlag = new Graphics()
              .moveTo(0, 13).lineTo(0, -13).stroke({ color: 0x784527, width: 2.5 })
              .poly([1, -12, 20, -8, 1, 1]).fill({ color: 0xffdb52 }).stroke({ color: 0xa95b2f, width: 2 });
            orderFlag.position.set(25, -38);
            accessory.addChild(orderFlag);
          }
        } else {
          const depot = new Graphics();
          depot.roundRect(-19, -12, 38, 31, 4).fill({ color: 0xeaa43d }).stroke({ color: 0x784527, width: 2.5 });
          depot.poly([-23, -12, 0, -27, 23, -12]).fill({ color: 0xb85431 }).stroke({ color: 0x784527, width: 2.5 });
          depot.roundRect(-6, 5, 12, 14, 2).fill({ color: 0x4e7658 });
          symbol.addChild(depot);
        }
        const label = new Text({
          text: marker.label,
          style: {
            align: "center",
            fill: 0x315140,
            fontFamily: "Arial",
            fontSize: 12,
            fontWeight: "800",
            wordWrap: true,
            wordWrapWidth: 145,
          },
        });
        const labelWidth = Math.max(80, label.width + 20);
        label.anchor.set(0.5, 0);
        label.position.set(0, 26);
        label.resolution = 3;
        const labelBoard = new Graphics()
          .roundRect(-labelWidth / 2, 21, labelWidth, label.height + 12, 7)
          .fill({ color: 0xfff8df, alpha: 0.98 })
          .stroke({ color: 0xd4c399, width: 1 });
        const statusSparks = isReady ? Array.from({ length: 3 }, (_, index) => {
          const spark = new Graphics()
            .poly([0, -6, 2, -2, 6, 0, 2, 2, 0, 6, -2, 2, -6, 0, -2, -2])
            .fill({ color: 0xffe870 })
            .stroke({ color: 0xc68730, width: 1.2 });
          spark.position.set([-34, 31, 5][index]!, [-33, -25, -53][index]!);
          accessory.addChild(spark);
          return spark;
        }) : [];
        container.addChild(footprint, groundGlow, pulse, symbol, accessory, labelBoard, label);
        footprint.visible = false;
        groundGlow.visible = false;
        pulse.visible = false;
        label.visible = !externalLabels;
        labelBoard.visible = !externalLabels;
        container.zIndex = marker.point.y * 1000;
        markerLayer.addChild(container);
        return { accessory, container, groundGlow, label, labelBoard, marker, pulse, point: marker.point, statusSparks };
      });

      const dust = Array.from({ length: 7 }, (_, index) => {
        const puff = new Graphics().circle(0, 0, 5 + index % 3 * 2).fill({ color: 0xf4dfac, alpha: 0.72 });
        dustLayer.addChild(puff);
        return puff;
      });

      const truckShadow = new Graphics().ellipse(0, 0, 50, 15).fill({ color: 0x3b4226, alpha: 0.28 });
      const truck = new Sprite(truckTexture);
      truck.anchor.set(0.5, 0.67);
      truckLayer.addChild(truckShadow, truck);

      const confetti = delivered ? Array.from({ length: 26 }, (_, index) => {
        const piece = new Graphics().roundRect(-2, -4, 4, 8, 1).fill({ color: [0xffd64a, 0xf25b45, 0x5bc17b, 0x64c7dc][index % 4] });
        celebrationLayer.addChild(piece);
        return piece;
      }) : [];

      markerLayer.sortableChildren = true;
      const roadSegments = showNetwork ? buildIslandRoadNetwork(normalizedMarkers) : [];
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const normalizedPoints = pointKey ? pointKey.split(";").map((value) => {
        const [x, y] = value.split(",").map(Number);
        return { x: x!, y: y! };
      }) : [];
      let elapsed = 0;
      let width = 0;
      let height = 0;
      let curves: Curve[] = [];

      function rebuildScene() {
        width = app.screen.width;
        height = app.screen.height;
        curves = normalizedPoints.slice(0, -1).map((point, index) => curveFor(
          { x: point.x * width, y: point.y * height },
          { x: normalizedPoints[index + 1]!.x * width, y: normalizedPoints[index + 1]!.y * height },
          index,
        ));

        roadShadow.clear();
        roadEdge.clear();
        roadSurface.clear();
        roadHighlight.clear();
        roadSegments.forEach((segment, index) => {
          const road = curveFor(
            { x: segment.start.x * width, y: segment.start.y * height },
            { x: segment.end.x * width, y: segment.end.y * height },
            index + 7,
          );
          for (const graphic of [roadShadow, roadEdge, roadSurface, roadHighlight]) {
            graphic.moveTo(road.start.x, road.start.y).bezierCurveTo(
              road.controlA.x,
              road.controlA.y,
              road.controlB.x,
              road.controlB.y,
              road.end.x,
              road.end.y,
            );
          }
        });
        const roadWidth = Math.max(4.5, width * 0.0053);
        roadShadow.stroke({ color: 0x334b2c, width: roadWidth + 7, alpha: 0.2 });
        roadEdge.stroke({ color: 0x906838, width: roadWidth + 4, alpha: 0.84 });
        roadSurface.stroke({ color: 0xe6c77e, width: roadWidth, alpha: 0.9 });
        roadHighlight.stroke({ color: 0xffe5a5, width: Math.max(1.2, roadWidth * 0.2), alpha: 0.64 });

        routeGlow.clear();
        routeLine.clear();
        for (const curve of curves) {
          routeGlow.moveTo(curve.start.x, curve.start.y).bezierCurveTo(
            curve.controlA.x,
            curve.controlA.y,
            curve.controlB.x,
            curve.controlB.y,
            curve.end.x,
            curve.end.y,
          );
          routeLine.moveTo(curve.start.x, curve.start.y).bezierCurveTo(
            curve.controlA.x,
            curve.controlA.y,
            curve.controlB.x,
            curve.controlB.y,
            curve.end.x,
            curve.end.y,
          );
        }
        routeGlow.stroke({ color: 0x6f4825, width: Math.max(12, width * 0.014), alpha: 0.25 });
        routeLine.stroke({ color: 0xf1cf86, width: Math.max(7, width * 0.008), alpha: 0.72 });

        shimmers.forEach((shimmer, index) => {
          const position = shimmerPositions[index]!;
          shimmer.position.set(position[0]! * width, position[1]! * height);
        });
        birds.forEach((bird, index) => {
          bird.position.set((0.33 + index * 0.1) * width, (0.13 + index * 0.035) * height);
        });
        worldMarkers.forEach(({ container, point }) => {
          container.position.set(point.x * width, point.y * height);
        });
      }

      function drawActiveTrail(curve: Curve, progress: number) {
        activeTrail.clear();
        const start = curvePoint(curve, 0);
        activeTrail.moveTo(start.x, start.y);
        for (let step = 1; step <= 20; step += 1) {
          const point = curvePoint(curve, progress * step / 20);
          activeTrail.lineTo(point.x, point.y);
        }
        activeTrail.stroke({ color: 0xffc63d, width: Math.max(9, width * 0.011), alpha: 0.82 });
      }

      rebuildScene();
      host.dataset.rendererReady = "true";
      onReadyRef.current?.();

      const tick = (ticker: { deltaMS: number }) => {
        if (app.screen.width !== width || app.screen.height !== height) rebuildScene();
        elapsed += ticker.deltaMS;

        const segmentIndex = Math.min(Math.max(activeSegment, 0), Math.max(curves.length - 1, 0));
        const curve = curves[segmentIndex];
        const arrivalProgress = delivered ? 1 : moving ? 0.5 : 0;
        const entrance = reducedMotion.matches ? 1 : Math.min(elapsed / 4300, 1);
        const easedEntrance = 1 - (1 - entrance) ** 3;
        const progress = arrivalProgress * easedEntrance;
        const point = curve ? curvePoint(curve, progress) : undefined;
        const direction = curve ? curveDirection(curve, progress) : { x: 1, y: 0 };
        const suspension = reducedMotion.matches ? 0 : Math.sin(elapsed / 115) * (moving && entrance < 1 ? 2.4 : 0.8);
        const truckWidth = vehicleWidth ?? Math.max(72, Math.min(118, width * 0.12));
        const scale = truckWidth / truckTexture.width;

        truckLayer.visible = Boolean(point);
        if (curve && point) {
          truckLayer.position.set(point.x, point.y + suspension);
          truck.scale.set(direction.x >= 0 ? -scale : scale, scale);
          truck.rotation = Math.max(-0.09, Math.min(0.09, Math.atan2(direction.y, Math.abs(direction.x)) * 0.13));
          truckShadow.scale.set(truckWidth / 105, truckWidth / 105);
          truckShadow.position.set(0, 5 - suspension * 0.3);
          drawActiveTrail(curve, progress);
        } else {
          activeTrail.clear();
        }

        routeLine.alpha = 0.78 + Math.sin(elapsed / 420) * 0.12;
        shimmers.forEach((shimmer, index) => {
          shimmer.alpha = reducedMotion.matches ? 0.38 : 0.2 + (Math.sin(elapsed / 620 + index * 1.7) + 1) * 0.24;
          shimmer.scale.x = 0.78 + Math.sin(elapsed / 810 + index) * 0.24;
        });
        birds.forEach((bird, index) => {
          if (reducedMotion.matches) return;
          const flight = (elapsed / (15000 + index * 1300) + index * 0.27) % 1;
          bird.x = (-0.06 + flight * 1.12) * width;
          bird.y = (0.11 + index * 0.045 + Math.sin(flight * Math.PI * 4 + index) * 0.018) * height;
          bird.scale.y = 0.72 + Math.sin(elapsed / 170 + index) * 0.18;
        });
        fieldMotes.forEach((mote, index) => {
          const phase = (elapsed / (3200 + index * 170) + index / fieldMotes.length) % 1;
          const originX = (0.25 + index % 3 * 0.08) * width;
          const originY = (0.41 + Math.floor(index / 3) * 0.08) * height;
          mote.position.set(originX + Math.sin(phase * Math.PI * 2 + index) * 13, originY - phase * 31);
          mote.alpha = reducedMotion.matches ? 0.28 : Math.sin(phase * Math.PI) * 0.62;
        });
        worldMarkers.forEach(({ accessory, container, groundGlow, label, labelBoard, marker, pulse, statusSparks }, index) => {
          const selected = marker.kind !== "DEPOT" && selectedStopRef.current === marker.sequence;
          const markerScale = marker.width !== undefined ? marker.width / ((marker.kind === "DROPOFF" ? 122 : 119) + marker.variant * 4) : Math.max(0.66, Math.min(1.08, width / 900)) * (showAllLabels ? 1.08 : 1) * (selected ? 1.08 : 1);
          container.scale.set(markerScale);
          container.y = marker.point.y * height;
          const lively = marker.state === "HARVEST_READY" || marker.state === "OPEN";
          const breathe = reducedMotion.matches ? 0 : (Math.sin(elapsed / 360 + index) + 1) * 0.08;
          groundGlow.alpha = (lively ? 0.2 : 0.1) + breathe;
          pulse.alpha = selected ? 0.42 + (reducedMotion.matches ? 0 : (Math.sin(elapsed / 230) + 1) * 0.2) : lively ? 0.2 + breathe * 0.7 : 0.1;
          pulse.scale.set(selected && !reducedMotion.matches ? 1 + (Math.sin(elapsed / 260) + 1) * 0.08 : 1);
          accessory.y = marker.state === "OPEN" && !reducedMotion.matches ? Math.sin(elapsed / 430 + index) * 1.5 : 0;
          statusSparks.forEach((spark, sparkIndex) => {
            spark.alpha = reducedMotion.matches ? 0.9 : 0.42 + (Math.sin(elapsed / 280 + sparkIndex * 1.9) + 1) * 0.28;
            spark.scale.set(reducedMotion.matches ? 0.9 : 0.82 + Math.sin(elapsed / 320 + sparkIndex) * 0.15);
          });
          label.alpha = showAllLabels || selected ? 1 : 0;
          labelBoard.alpha = showAllLabels || selected ? 1 : 0;
        });

        dust.forEach((puff, index) => {
          const phase = (elapsed / 760 + index / dust.length) % 1;
          const travelling = moving && entrance < 1;
          puff.visible = Boolean(point) && travelling && !reducedMotion.matches;
          puff.alpha = (1 - phase) * 0.42;
          puff.scale.set(0.35 + phase * 1.15);
          const behind = direction.x >= 0 ? -1 : 1;
          if (point) puff.position.set(point.x + behind * (truckWidth * 0.34 + phase * 31), point.y + 11 - phase * 19 + (index % 2 ? 5 : -3));
        });

        if (delivered && confetti.length) {
          const finish = normalizedPoints.at(-1)!;
          confetti.forEach((piece, index) => {
            const cycle = (elapsed / 1900 + index / confetti.length) % 1;
            const angle = index * 2.399;
            piece.position.set(
              finish.x * width + Math.cos(angle) * (24 + cycle * 90),
              finish.y * height - 54 + cycle * 128 + Math.sin(angle) * 18,
            );
            piece.alpha = Math.sin(cycle * Math.PI);
            piece.rotation = angle + cycle * 7;
          });
        }
      };
      app.ticker.add(tick);

      const onVisibilityChange = () => {
        if (document.hidden) app.ticker.stop();
        else app.ticker.start();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      cleanup = () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        app.ticker.remove(tick);
        app.destroy(false, { children: true });
      };
    })().catch(() => {
      host.dataset.rendererFailed = "true";
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [activeSegment, delivered, markerPayload, moving, pointKey, showAllLabels, externalLabels, showNetwork, vehicleWidth]);

  return (
    <div
      className="island-game-renderer"
      data-motion={reducedMotion ? "reduced" : "full"}
      data-position={moving ? "mid-leg" : "at-stop"}
      ref={hostRef}
    >
      <canvas className="island-game-canvas" ref={canvasRef} aria-hidden="true" />
    </div>
  );
}
