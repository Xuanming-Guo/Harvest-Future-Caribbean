# Harvest island artwork

## Active v3 island scenes

Each `*-world-v3.webp` is a complete individualized 3D diorama rendered in
Blender 4.2 LTS / Cycles. The 28 assets total approximately 3.34 MB. No asset is
a shared Saint Lucia texture cropped to another island's outline. The image
API was attempted with the user's authorization but returned
`credit_balance_exhausted`, so these assets use the authorized open-source
fallback. They are not API-generated images.

The terrain mesh uses each island's elevation and coastline. Forests, palms,
clearings, flowers, lighting, and coastal rocks are illustrative scenery;
they are not observed land cover. Dry, limestone, seasonal, and rainforest
palettes keep the islands from all receiving the same vegetation treatment.
Relief is vertically exaggerated for a legible oblique illustration. Natural
Earth's generalized coastlines and administrative divisions remain the source
geometry, including island groups and territories sharing a physical island.

Scenes use a 1800 by 1200 transparent canvas and an orthographic camera 45
degrees above the ground. Ocean ripples and shallows follow each rendered
silhouette and fade to alpha, avoiding rectangular seams during pan or regional
navigation. The browser runs no Blender process and downloads no terrain tiles.
Farm and hotel sprites are overlaid separately at geographic scale.

`world-manifest.json` records final hashes, tile identifiers, sampled elevation
ranges, palette, canopy count, relief exaggeration, and camera parameters.
`src/lib/island-art-registration.json` stores the render's sampled terrain
heights. `islandScenePoint` projects place overlays with that same camera;
responsive fitting scales both the art and projected points together. API zones
remain authoritative; these positions are display positions, not surveyed
property coordinates or road directions.

### Rebuild v3

From the repository root, using uv and a disposable cache:

```powershell
uv run --no-project --python 3.11 --with bpy==4.2.22 --with numpy --with scipy --with pillow python app/website/scripts/render-island-world.py --cache "$env:TEMP/harvest-island-world-build" --island saint-lucia --samples 24
```

Omit `--island` to render missing catalogue entries; repeat it to rebuild
selected islands. Commit selected WebP artwork, its manifest, and its height
registration together. Delete the task-owned tile cache after inspection.
Blender is GPL licensed; NumPy, SciPy and Pillow are open-source dependencies.

## Geographic v2 guides

Each `*-terrain-v2.webp` is a complete, separately rendered island environment.
No asset samples the former `saint-lucia-terrain-v1.webp`, and the browser does
not crop that shared image into different silhouettes.

The terrain surface uses georeferenced elevation and bathymetry from Mapzen
Terrarium tiles. Coastlines register the scene to the existing geographic
catalogue. Relief shading and ambient lighting are derived from elevation;
coastal water uses bathymetry and shoreline distance. Vegetation colours,
canopy texture, lighting exaggeration and sandy shoreline treatment are
illustrative art choices. These assets are not land-cover observations,
survey-grade topography, property locations or navigation charts.

All scenes use a common 1800 by 1200 transparent canvas, north up, with the same
lighting direction. Their geographic registration is shared with the map's
property and route overlays, including responsive fit. Terrain is pre-rendered:
the participant browser never downloads elevation tiles or runs the renderer.
The original farm/hotel sprites and crop-detail scenes are retained separately.

## Sources and credit

- Elevation tiles: https://registry.opendata.aws/terrain-tiles/
- Terrarium format: https://github.com/tilezen/joerd/blob/master/docs/formats.md
- SRTM and GMTED2010 elevation data courtesy of the U.S. Geological Survey.
- ETOPO1 global relief data courtesy of NOAA.
- Source attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- Coastlines: Natural Earth 1:10m admin-0 map subunits; see the website README.

`terrain-manifest.json` records every output's hash, sampled elevation range,
material palette, source tile identifiers and source bounds. Elevation ranges
are raster sample ranges, not authoritative summit heights. Data was retrieved
on September 6, 2026. The renderer modifies the source data for illustration;
no endorsement by a source agency is implied.

## Rebuild

Requires Python 3, NumPy, SciPy and Pillow. From the repository root:

```powershell
python app/website/scripts/render-island-terrain.py --cache "$env:TEMP/harvest-island-terrain-build" --island jamaica
```

Omit `--island` to build missing assets for all 28 entries. Repeat `--island` to
rebuild selected entries. The explicit cache is disposable after rendering.
Commit intended WebP artwork and its manifest together; never commit raw tile
caches. Changing the canonical canvas registration requires updating
`island-geography.ts` and validating overlay positions alongside the art.
