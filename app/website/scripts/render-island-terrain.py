"""Render Harvest island environments from georeferenced Mapzen elevation tiles.

Requires Python 3, numpy, scipy and Pillow. Source tiles are downloaded into an
explicit disposable cache; only rendered WebP assets and their manifest ship.
No property coordinates or operational records are read or generated.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import math
from pathlib import Path
import time
import urllib.request
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt, gaussian_filter, map_coordinates

ROOT = Path(__file__).resolve().parents[1]
SIZE = (1800, 1200)
SCALE = SIZE[0] / 1500
SOURCE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium"
MATERIALS = {
    "aruba": "dry", "curacao": "dry", "bonaire-sint-eustatius-saba": "dry",
    "cayman-islands": "limestone", "bahamas": "limestone", "turks-caicos-islands": "limestone", "anguilla": "limestone",
    "antigua-barbuda": "seasonal", "barbados": "seasonal", "british-virgin-islands": "seasonal",
    "united-states-virgin-islands": "seasonal", "saint-barthelemy": "seasonal",
    "saint-martin-french-part": "seasonal", "sint-maarten-dutch-part": "seasonal",
    "haiti": "seasonal", "cuba": "seasonal",
}
PALETTES = {
    "rainforest": [[151, 172, 87], [112, 151, 69], [64, 118, 63], [49, 100, 62], [97, 125, 71]],
    "seasonal": [[190, 186, 115], [154, 170, 91], [102, 139, 72], [67, 113, 66], [117, 133, 83]],
    "dry": [[213, 195, 139], [188, 176, 111], [157, 158, 90], [129, 143, 83], [155, 145, 108]],
    "limestone": [[157, 182, 113], [142, 174, 101], [116, 157, 85], [105, 145, 82], [144, 168, 108]],
}

def tile_position(lon, lat, z):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n

def download_tile(task):
    z, x, y, cache = task
    path = cache / f"{z}-{x}-{y}.png"
    if not path.exists():
        for attempt in range(3):
            try:
                request = urllib.request.Request(f"{SOURCE}/{z}/{x}/{y}.png", headers={"User-Agent": "HarvestTerrainArt/1.0"})
                data = urllib.request.urlopen(request, timeout=30).read()
                Image.open(io.BytesIO(data)).verify()
                path.write_bytes(data)
                break
            except Exception:
                if attempt == 2: raise
                time.sleep(attempt + 1)
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    return x, y, rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768

def relief_grid(rings, cache):
    points = np.array([point for ring in rings for point in ring])
    lon0, lat0 = points.min(axis=0); lon1, lat1 = points.max(axis=0)
    projected_width, projected_height = (lon1 - lon0) * 42, (lat1 - lat0) * 44.2
    fit = min(1150 / projected_width, 750 / projected_height)
    center_lon, center_lat = (lon0 + lon1) / 2, (lat0 + lat1) / 2
    lon_span = SIZE[0] / SCALE / fit / 42
    lat_span = SIZE[1] / SCALE / fit / 44.2
    left = center_lon - 750 / fit / 42
    top = center_lat + 480 / fit / 44.2
    xs = left + np.arange(SIZE[0]) / SCALE / fit / 42
    ys = top - np.arange(SIZE[1]) / SCALE / fit / 44.2
    # A reproducible source resolution matched to the rendered canvas, capped at
    # zoom 13: source SRTM resolution does not improve by oversampling beyond it.
    z = max(6, min(13, math.ceil(math.log2(1500 * 360 / (256 * lon_span)))))
    tx, ty = tile_position(xs, ys, z)
    x0, x1, y0, y1 = math.floor(tx.min()), math.floor(tx.max()), math.floor(ty.min()), math.floor(ty.max())
    tasks = [(z, x, y, cache) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    mosaic = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), dtype=np.float32)
    with ThreadPoolExecutor(max_workers=8) as executor:
        for x, y, tile in executor.map(download_tile, tasks):
            mosaic[(y - y0)*256:(y - y0 + 1)*256, (x - x0)*256:(x - x0 + 1)*256] = tile
    mx, my = np.meshgrid((tx - x0) * 256, (ty - y0) * 256)
    elevation = map_coordinates(mosaic, [my, mx], order=1, mode="nearest")
    land = Image.new("L", SIZE)
    draw = ImageDraw.Draw(land)
    for ring in rings:
        coords = [((lon - left) * fit * 42 * SCALE, (top - lat) * fit * 44.2 * SCALE) for lon, lat in ring]
        draw.polygon(coords, fill=255)
    mask = np.asarray(land) > 0
    meters = lon_span * 111320 * math.cos(math.radians(center_lat)) / SIZE[0]
    return elevation, mask, meters, {"zoom": z, "tiles": [f"{z}/{x}/{y}" for _, x, y, _ in tasks], "bounds": [left, top-lat_span, left+lon_span, top]}

def render(island_id, rings, cache, output):
    elevation, land, meters, source = relief_grid(rings, cache)
    h, w = land.shape
    material = MATERIALS.get(island_id, "rainforest")
    rng = np.random.default_rng(int(hashlib.sha256(island_id.encode()).hexdigest()[:8], 16))
    inland = distance_transform_edt(land)
    offshore = distance_transform_edt(~land)
    dem = gaussian_filter(np.maximum(elevation, 0), .9)
    dy, dx = np.gradient(dem, meters, meters)
    slope = np.hypot(dx, dy)
    # Two scales of relief preserve broad mountain masses and their smaller
    # drainage ridges. Lighting is identical across the entire art collection.
    nx, ny, nz = -dx * 2.5, -dy * 2.5, np.ones_like(dx)
    length = np.sqrt(nx*nx + ny*ny + nz*nz)
    lighting = (nx * -.48 + ny * -.56 + nz * .68) / length
    ambient = np.clip((dem - gaussian_filter(dem, 16)) / 95, -.22, .15)
    shading = np.clip(.83 + lighting * .34 + ambient, .58, 1.22)
    broad = gaussian_filter(rng.normal(size=(h,w)).astype(np.float32), 27)
    broad /= max(float(broad.std()), .001)
    fine = gaussian_filter(rng.normal(size=(h,w)).astype(np.float32), 1.6)
    fine /= max(float(fine.std()), .001)
    # Elevation is measured; the vegetation palette and painterly surface are
    # an explicit visual interpretation, not satellite land-cover observations.
    levels = np.array([0, 60, 250, 650, 1800])
    palette = np.array(PALETTES[material])
    height_color = np.clip(dem + broad * 27, 0, 1800)
    color = np.stack([np.interp(height_color, levels, palette[:,channel]) for channel in range(3)],axis=-1)
    color *= shading[:,:,None]
    color += (fine * 2.1 + broad * 1.6)[:,:,None]
    cliff = np.clip((slope - .6) * .26, 0, .24)
    color = color * (1 - cliff[:,:,None]) + np.array([162,151,113]) * cliff[:,:,None]
    # Sand follows the actual shore and thins on steep volcanic coastlines.
    sand_width = np.clip((2.0 if material == "limestone" else 3.2) - dem / 35 - slope * 3, .5, 3.2)
    sand = np.clip(sand_width - inland + 1, 0, 1) * land
    color = color * (1-sand[:,:,None]) + np.array([235,219,168]) * sand[:,:,None]
    # Bathymetry controls broad banks; distance-to-shore supplies a consistent
    # illustrated near-shore fringe even where bathymetry resolution is coarse.
    depth = gaussian_filter(np.maximum(0, -elevation), 3.5)
    shallow = np.exp(-offshore / (24 if material == "limestone" else 14))
    bank = np.exp(-depth / 25) * np.exp(-offshore / 65) * .5
    shallows = np.clip(shallow + bank, 0, 1)
    sea = np.array([35,159,171])[None,None,:] + shallows[:,:,None] * np.array([70,53,19])
    foam = np.exp(-((offshore - 2.2) / 1.2)**2) * .32
    sea = sea * (1-foam[:,:,None]) + np.array([215,241,211]) * foam[:,:,None]
    rgb = np.where(land[:,:,None], color, sea)
    alpha = np.where(land, 255, np.clip((90 - offshore) / 34, 0, 1) * 255)
    rgba = np.dstack((np.clip(rgb,0,255).astype(np.uint8),alpha.astype(np.uint8)))
    art = Image.fromarray(rgba,"RGBA")
    # Small hand-painted canopy clusters give close zooms their game-world
    # texture. These decorate the measured relief instead of replacing it.
    trees = Image.new("RGBA",SIZE)
    t = ImageDraw.Draw(trees)
    density = {"rainforest": .72, "seasonal": .40, "limestone": .24, "dry": .09}[material]
    for y in range(14,h-14,9):
        for x in range(14,w-14,9):
            px,py = x+int(rng.integers(-3,4)),y+int(rng.integers(-3,4))
            if inland[py,px] < 9 or rng.random() > density or slope[py,px] > 1.5: continue
            if dem[py,px] < 15 and material != "limestone": continue
            r = float(rng.uniform(2.5,5.0)); light = float(shading[py,px])
            base = np.array([72,115,49]) if material == "rainforest" else np.array([119,144,63])
            base = np.clip(base * light,0,255).astype(int)
            t.ellipse((px-r+2,py-r/2+2,px+r+3,py+r/2+4),fill=(30,63,44,48))
            t.ellipse((px-r,py-r,px+r,py+r*.55), fill=(*base,190))
            t.ellipse((px-r*.7,py-r*.95,px+r*.25,py-r*.1),fill=(*np.clip(base+np.array([32,34,12]),0,255),190))
    art = Image.alpha_composite(art,trees)
    output.mkdir(parents=True,exist_ok=True)
    path = output / f"{island_id}-terrain-v2.webp"
    art.save(path,"WEBP",quality=88,method=6)
    return {"asset": f"/art/islands/{path.name}", "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "material": material, "elevationRangeMeters": [max(0, round(float(elevation[land].min()))),round(float(elevation[land].max()))], "source": source}

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--cache",type=Path,required=True)
    parser.add_argument("--island",action="append")
    args=parser.parse_args();args.cache.mkdir(parents=True,exist_ok=True)
    coast=json.loads((ROOT/"src/lib/island-coastlines.json").read_text())
    output=ROOT/"public/art/islands"
    manifest_path=output/"terrain-manifest.json"
    manifest=json.loads(manifest_path.read_text()) if manifest_path.exists() else {"version":2,"dimensions":list(SIZE),"rendering":"Elevation-derived relief with illustrative vegetation and coastal water", "attribution":"Mapzen terrain tiles; SRTM and GMTED2010 data courtesy of USGS; ETOPO1 courtesy of NOAA. Coastlines: Natural Earth.","islands":{}}
    for island in args.island or coast:
        if not args.island and island in manifest["islands"] and (output/Path(manifest["islands"][island]["asset"]).name).exists(): continue
        result=render(island,coast[island],args.cache,output)
        manifest["islands"][island]=result
        manifest_path.write_text(json.dumps(manifest,indent=2)+"\n")
        print(island,result["elevationRangeMeters"],flush=True)

if __name__ == "__main__": main()
