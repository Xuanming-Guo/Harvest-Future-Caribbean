# Island environment art direction

The reference is the user's former Harvest World view, cropped to its artwork
so account information and UI panels are excluded. Its perspective, lushness,
lighting and dimensional features guide the island scenes.

`island-scenes.json` preserves one image-generation brief and one geography
guide per island. `saint-lucia-pilot.txt` is the exact pilot prompt sent to the
image API with the style reference and Saint Lucia layout guide.

The user authorized the image API and an open-source fallback. The API returned
`credit_balance_exhausted`; no API image was generated. The completed v3 assets
use Blender 4.2 LTS / Cycles instead. These are rendered 3D dioramas, rather than
a claim that the original hand-painted reference was reproduced exactly.

Each scene uses its own coastline and elevation data, dimensional terrain,
modeled canopy and palms, coastal boulders, and transparent shallow water.
Lighting and camera orientation are shared across the set. Property buildings
remain independent, physically small overlays. The browser uses the renderer's
height registration to place markers on the angled terrain. Existing detailed
farm and hotel art remains the destination of place navigation.

The v2 images are retained as geographic layout guides. Runtime views use the
28 `public/art/islands/*-world-v3.webp` assets. Source provenance, hashes,
render settings, and rebuild instructions are beside the artwork. Future art
changes should be checked in the workspace at both desktop and phone sizes.
