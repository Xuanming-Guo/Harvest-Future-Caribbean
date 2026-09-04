"use client";

import { useEffect, useRef, useState } from "react";

export type IslandPoint = { x: number; y: number };
export type IslandMarker = {
  kind: "DEPOT" | "PICKUP" | "DROPOFF";
  label: string;
  point: IslandPoint;
  sequence: number;
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
};

type Curve = {
  start: IslandPoint;
  controlA: IslandPoint;
  controlB: IslandPoint;
  end: IslandPoint;
};

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

export function IslandGameCanvas({ activeSegment, delivered, markers, moving, onReady, points, selectedStop, showAllLabels = false }: IslandGameCanvasProps) {
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

      const [truckTexture, farmTexture, hotelTexture] = await Promise.all([
        Assets.load("/art/delivery-truck-game.webp"),
        Assets.load("/art/farm-location-game.webp"),
        Assets.load("/art/hotel-location-game.webp"),
      ]);
      if (cancelled) {
        app.destroy(false, { children: true });
        return;
      }

      const routeLayer = new Container();
      const ambientLayer = new Container();
      const markerLayer = new Container();
      const dustLayer = new Container();
      const truckLayer = new Container();
      const celebrationLayer = new Container();
      app.stage.addChild(routeLayer, ambientLayer, markerLayer, dustLayer, truckLayer, celebrationLayer);

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
        const labelSide = marker.point.x < 0.42 ? "right" : marker.point.x > 0.58 ? "left" : "center";
        const markerColor = marker.kind === "PICKUP" ? 0x55c982 : marker.kind === "DROPOFF" ? 0xff8262 : 0xffca52;
        const groundGlow = new Graphics().ellipse(0, 12, 43, 14).fill({ color: markerColor, alpha: 0.18 });
        const pulse = new Graphics().ellipse(0, 7, 48, 28).stroke({ color: markerColor, width: 4, alpha: 0.8 });
        const symbol = new Container();
        if (marker.kind === "PICKUP") {
          const farm = new Sprite(farmTexture);
          farm.anchor.set(0.5, 0.75);
          farm.scale.set(94 / farmTexture.width);
          symbol.addChild(farm);
        } else if (marker.kind === "DROPOFF") {
          const hotel = new Sprite(hotelTexture);
          hotel.anchor.set(0.5, 0.75);
          hotel.scale.set(91 / hotelTexture.width);
          symbol.addChild(hotel);
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
            align: labelSide === "right" ? "left" : labelSide === "left" ? "right" : "center",
            fill: 0x315140,
            fontFamily: "Arial",
            fontSize: 10,
            fontWeight: "800",
            wordWrap: true,
            wordWrapWidth: 104,
          },
        });
        const labelWidth = Math.min(118, Math.max(70, label.width + 18));
        const labelX = labelSide === "right" ? 48 : labelSide === "left" ? -48 : 0;
        const boardX = labelSide === "right" ? 43 : labelSide === "left" ? -43 - labelWidth : -labelWidth / 2;
        label.anchor.set(labelSide === "right" ? 0 : labelSide === "left" ? 1 : 0.5, 0);
        label.position.set(labelX, 28);
        const labelBoard = new Graphics()
          .roundRect(boardX, 24, labelWidth, label.height + 10, 7)
          .fill({ color: 0xfff5c9, alpha: 0.96 })
          .stroke({ color: 0xb98943, width: 2 });
        container.addChild(groundGlow, pulse, symbol, labelBoard, label);
        markerLayer.addChild(container);
        return { container, groundGlow, label, labelBoard, marker, pulse, point: marker.point };
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
        const truckWidth = Math.max(72, Math.min(118, width * 0.12));
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
        worldMarkers.forEach(({ container, groundGlow, label, labelBoard, marker, pulse }, index) => {
          const selected = marker.kind !== "DEPOT" && selectedStopRef.current === marker.sequence;
          const markerScale = Math.max(0.66, Math.min(1.08, width / 900)) * (showAllLabels ? 1.08 : 1) * (selected ? 1.08 : 1);
          container.scale.set(markerScale);
          container.y = marker.point.y * height;
          groundGlow.alpha = 0.12 + (Math.sin(elapsed / 360 + index) + 1) * 0.08;
          pulse.alpha = selected ? 0.42 + (Math.sin(elapsed / 230) + 1) * 0.2 : 0.16;
          pulse.scale.set(selected ? 1 + (Math.sin(elapsed / 260) + 1) * 0.08 : 1);
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
  }, [activeSegment, delivered, markerPayload, moving, pointKey, showAllLabels]);

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
