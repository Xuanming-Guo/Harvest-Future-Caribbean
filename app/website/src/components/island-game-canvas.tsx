"use client";

import { useEffect, useRef, useState } from "react";

export type IslandPoint = { x: number; y: number };

type IslandGameCanvasProps = {
  activeSegment: number;
  delivered: boolean;
  moving: boolean;
  points: IslandPoint[];
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

export function IslandGameCanvas({ activeSegment, delivered, moving, points }: IslandGameCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const pointKey = points.map((point) => `${point.x},${point.y}`).join(";");

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
      const { Application, Assets, Container, Graphics, Sprite } = await import("pixi.js");
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

      const truckTexture = await Assets.load("/art/delivery-truck-game.webp");
      if (cancelled) {
        app.destroy(false, { children: true });
        return;
      }

      const routeLayer = new Container();
      const ambientLayer = new Container();
      const dustLayer = new Container();
      const truckLayer = new Container();
      app.stage.addChild(routeLayer, ambientLayer, dustLayer, truckLayer);

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

      const dust = Array.from({ length: 7 }, (_, index) => {
        const puff = new Graphics().circle(0, 0, 5 + index % 3 * 2).fill({ color: 0xf4dfac, alpha: 0.72 });
        dustLayer.addChild(puff);
        return puff;
      });

      const truckShadow = new Graphics().ellipse(0, 0, 50, 15).fill({ color: 0x3b4226, alpha: 0.28 });
      const truck = new Sprite(truckTexture);
      truck.anchor.set(0.5, 0.67);
      truckLayer.addChild(truckShadow, truck);

      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const normalizedPoints = pointKey.split(";").map((value) => {
        const [x, y] = value.split(",").map(Number);
        return { x: x!, y: y! };
      });
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
        routeGlow.stroke({ color: 0x5c3b1f, width: Math.max(7, width * 0.009), alpha: 0.28 });
        routeLine.stroke({ color: 0xfff3b0, width: Math.max(3, width * 0.004), alpha: 0.9 });

        shimmers.forEach((shimmer, index) => {
          const position = shimmerPositions[index]!;
          shimmer.position.set(position[0]! * width, position[1]! * height);
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
        activeTrail.stroke({ color: 0xffc63d, width: Math.max(8, width * 0.011), alpha: 0.74 });
      }

      rebuildScene();
      host.dataset.rendererReady = "true";

      const tick = (ticker: { deltaMS: number }) => {
        if (app.screen.width !== width || app.screen.height !== height) rebuildScene();
        elapsed += ticker.deltaMS;

        const segmentIndex = Math.min(Math.max(activeSegment, 0), Math.max(curves.length - 1, 0));
        const curve = curves[segmentIndex];
        if (!curve) return;
        const arrivalProgress = delivered ? 1 : moving ? 0.5 : 0;
        const entrance = reducedMotion.matches ? 1 : Math.min(elapsed / 4300, 1);
        const easedEntrance = 1 - (1 - entrance) ** 3;
        const progress = arrivalProgress * easedEntrance;
        const point = curvePoint(curve, progress);
        const direction = curveDirection(curve, progress);
        const suspension = reducedMotion.matches ? 0 : Math.sin(elapsed / 115) * (moving && entrance < 1 ? 2.4 : 0.8);
        const truckWidth = Math.max(72, Math.min(118, width * 0.12));
        const scale = truckWidth / truckTexture.width;

        truckLayer.position.set(point.x, point.y + suspension);
        truck.scale.set(direction.x >= 0 ? -scale : scale, scale);
        truck.rotation = Math.max(-0.09, Math.min(0.09, Math.atan2(direction.y, Math.abs(direction.x)) * 0.13));
        truckShadow.scale.set(truckWidth / 105, truckWidth / 105);
        truckShadow.position.set(0, 5 - suspension * 0.3);
        drawActiveTrail(curve, progress);

        routeLine.alpha = 0.78 + Math.sin(elapsed / 420) * 0.12;
        shimmers.forEach((shimmer, index) => {
          shimmer.alpha = reducedMotion.matches ? 0.38 : 0.2 + (Math.sin(elapsed / 620 + index * 1.7) + 1) * 0.24;
          shimmer.scale.x = 0.78 + Math.sin(elapsed / 810 + index) * 0.24;
        });

        dust.forEach((puff, index) => {
          const phase = (elapsed / 760 + index / dust.length) % 1;
          const travelling = moving && entrance < 1;
          puff.visible = travelling && !reducedMotion.matches;
          puff.alpha = (1 - phase) * 0.42;
          puff.scale.set(0.35 + phase * 1.15);
          const behind = direction.x >= 0 ? -1 : 1;
          puff.position.set(point.x + behind * (truckWidth * 0.34 + phase * 31), point.y + 11 - phase * 19 + (index % 2 ? 5 : -3));
        });
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
  }, [activeSegment, delivered, moving, pointKey]);

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
