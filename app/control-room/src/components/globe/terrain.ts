/**
 * Real elevation for the globe, without a credential.
 *
 * Cesium renders a smooth ellipsoid unless given a terrain provider, so the
 * control room showed satellite imagery draped over a sphere. That is a poor
 * showing for an island whose entire logistics problem is its topography:
 * Mount Gimie is 950 m, the Pitons rise straight out of the sea, and the
 * interior roads wash out because they switchback through steep valleys.
 *
 * Cesium's own global terrain is an ion asset and needs a token. So does
 * Google's photogrammetry mesh, which in any case covers mainly large cities
 * and would give Saint Lucia nothing. AWS publishes the Terrarium elevation
 * tileset openly, with CORS and no key, so this implements a provider for it.
 *
 * THE DECODING TRICK. Terrarium encodes height in RGB as
 *
 *     height_metres = (R * 256 + G + B / 256) - 32768
 *
 * which looks like it needs a per-pixel decode over every tile. It does not.
 * Cesium's `HeightmapTerrainData` takes a `structure` describing how to read
 * heights out of an arbitrary buffer, computing
 *
 *     value  = R * 256^2 + G * 256 + B     (elementsPerHeight 3, big-endian)
 *     height = value * heightScale + heightOffset
 *
 * and the Terrarium formula is exactly `value / 256 - 32768`. Setting
 * `heightScale = 1/256` and `heightOffset = -32768` lets the raw RGBA bytes go
 * straight to Cesium with no decoding pass at all.
 */

import type {
  Credit,
  Event as CesiumEvent,
  HeightmapTerrainData,
  Request as CesiumRequest,
  TerrainProvider,
  TileAvailability,
  TilingScheme,
} from "cesium";

import type { CesiumModule } from "./entities";

/** Open elevation tiles: CORS-enabled, no key, no account. */
const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/**
 * Terrarium publishes to zoom 15, but the underlying data over small Caribbean
 * islands is SRTM at roughly 30 m, so deeper zooms fetch more tiles to show the
 * same detail. Stopping here keeps the tile count sane during a camera flight.
 */
const MAXIMUM_LEVEL = 13;

const TILE_SIZE = 256;

export function createTerrariumTerrainProvider(Cesium: CesiumModule): TerrainProvider {
  const tilingScheme = new Cesium.WebMercatorTilingScheme({ ellipsoid: Cesium.Ellipsoid.WGS84 });
  const errorEvent = new Cesium.Event();
  const credit = new Cesium.Credit("Elevation: Terrain Tiles on AWS (SRTM, NED and others)", false);

  const levelZeroMaximumGeometricError =
    Cesium.TerrainProvider.getEstimatedLevelZeroGeometricErrorForAHeightmap(
      tilingScheme.ellipsoid,
      TILE_SIZE,
      tilingScheme.getNumberOfXTilesAtLevel(0),
    );

  /**
   * One reusable canvas for every tile decode.
   *
   * A canvas per tile would churn hundreds of them during a single camera
   * flight. Tiles are decoded one at a time on the main thread, so sharing is
   * safe.
   */
  let scratch: HTMLCanvasElement | null = null;
  let scratchContext: CanvasRenderingContext2D | null = null;

  function readPixels(image: CanvasImageSource): Uint8Array | null {
    if (!scratch) {
      scratch = document.createElement("canvas");
      scratch.width = TILE_SIZE;
      scratch.height = TILE_SIZE;
      // willReadFrequently: this canvas exists only to be read back, and
      // without the hint browsers keep it GPU-side so every read stalls.
      scratchContext = scratch.getContext("2d", { willReadFrequently: true });
    }
    if (!scratchContext) return null;

    scratchContext.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    scratchContext.drawImage(image, 0, 0, TILE_SIZE, TILE_SIZE);
    return new Uint8Array(scratchContext.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data.buffer);
  }

  /**
   * A flat tile, used when a fetch or decode fails.
   *
   * Returning sea level rather than rejecting matters: Cesium treats a rejected
   * tile request as a terrain error and stops refining that branch of the
   * quadtree, which appears as a permanent hole in the globe. One missing tile
   * should cost detail, not correctness.
   */
  function flatTile(): HeightmapTerrainData {
    return new Cesium.HeightmapTerrainData({
      buffer: new Uint8Array(TILE_SIZE * TILE_SIZE),
      width: TILE_SIZE,
      height: TILE_SIZE,
    });
  }

  const provider = {
    get errorEvent(): CesiumEvent {
      return errorEvent;
    },
    get credit(): Credit {
      return credit;
    },
    get tilingScheme(): TilingScheme {
      return tilingScheme;
    },
    get hasWaterMask(): boolean {
      return false;
    },
    get hasVertexNormals(): boolean {
      return false;
    },
    // Terrarium publishes no availability metadata; coverage is uniform across
    // the tiling scheme up to MAXIMUM_LEVEL.
    get availability(): TileAvailability | undefined {
      return undefined;
    },

    getLevelMaximumGeometricError(level: number): number {
      return levelZeroMaximumGeometricError / (1 << level);
    },

    getTileDataAvailable(_x: number, _y: number, level: number): boolean {
      return level <= MAXIMUM_LEVEL;
    },

    async loadTileDataAvailability(): Promise<void> {
      // Nothing to load; availability is a level check.
    },

    requestTileGeometry(
      x: number,
      y: number,
      level: number,
      request?: CesiumRequest,
    ): Promise<HeightmapTerrainData> | undefined {
      if (level > MAXIMUM_LEVEL) return undefined;

      const resource = new Cesium.Resource({
        url: TERRARIUM_URL,
        templateValues: { z: String(level), x: String(x), y: String(y) },
        request,
      });

      const promise = resource.fetchImage({ preferImageBitmap: true });
      // Cesium returns undefined when its request scheduler is saturated. That
      // means "retry later", not "failed", and must be propagated rather than
      // turned into a resolved flat tile.
      if (!promise) return undefined;

      return promise
        .then((image) => {
          if (!image) return flatTile();
          const pixels = readPixels(image as CanvasImageSource);
          if (!pixels) return flatTile();

          return new Cesium.HeightmapTerrainData({
            buffer: pixels,
            width: TILE_SIZE,
            height: TILE_SIZE,
            structure: {
              // height = (R*256^2 + G*256 + B)/256 - 32768, the Terrarium
              // formula rearranged. See the note at the top of this file.
              heightScale: 1 / 256,
              heightOffset: -32768,
              elementsPerHeight: 3,
              stride: 4,
              elementMultiplier: 256,
              isBigEndian: true,
            },
          });
        })
        .catch(() => flatTile());
    },
  };

  // Cesium types TerrainProvider as a class, so a structural implementation
  // needs an assertion. Every member the runtime calls is present above; the
  // cast is about nominal typing, not missing behaviour.
  return provider as unknown as TerrainProvider;
}
