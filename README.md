# Stellar Observer (Atlas)

Stellar Observer consists of two cleanly separated parts:

1. **Python data builder** – generates static JSON datasets (stars, lines, boundaries).
2. **Static web frontend** – renders an interactive sky atlas from those datasets.

Python runs once and exits. The browser only reads JSON.
There is no runtime coupling between Python and JavaScript.

---

## Python: `atlas_builder/`

The Python package is a **pure data pipeline**. It knows nothing about HTML, SVG, or UI.

### `config.py`
Central build configuration.

Defines:
- output directories and filenames
- magnitude thresholds (default: 6.0)
- cache locations
- Skyfield data directory
- Stellarium skyculture selection (`modern_st` or `modern`)
- API endpoints and timeouts

**Key Configuration:**
- `STELLARIUM_SKYCULTURE`: Choose between `"modern_st"` (simplified lines) or `"modern"` (traditional Western figures)
- `MAX_MAGNITUDE`: Stars brighter than this value are included (default 6.0)
- `BOUNDARY_DENSIFICATION_STEPS`: Controls smoothness of constellation boundaries (default 10)

Exists to eliminate magic constants and make build behavior easy to reason about.

---

### `logging_utils.py`
Small logging helper used across the builder.

Provides consistent, readable progress output for long-running steps
(downloads, SIMBAD queries, preprocessing).

Functions:
- `log(message, level)`: Simple colored console output
- `log_step(step_name, details)`: Structured pipeline step logging

---

### `hipparcos_catalog.py`
Loads and filters the Hipparcos star catalog using Skyfield.

Responsibilities:
- download and cache Hipparcos data (~118,000 stars)
- return a cleaned pandas DataFrame
- filter stars by magnitude
- *also keep faint stars required by constellation lines*

This prevents broken constellation lines in the final atlas.

Key functions:
- `load_hipparcos_catalog()`: Downloads and caches catalog
- `filter_stars_by_magnitude(df, max_mag, required_hip_ids)`: Smart filtering that preserves line integrity

---

### `stellarium_lines.py`
Parses Stellarium's constellation line definitions from GitHub.

Outputs:
- HIP IDs referenced by lines (for star filtering)
- normalized line polylines as HIP ID pairs

Handles two skycultures:
- **modern_st**: Simplified stick figures (cleaner, fewer lines)
- **modern**: Traditional Western constellation figures (more detailed)

Constellation ID format: Extracts 3-letter code from `"CON modern_st Ori"` → `"Ori"`

Isolated because the Stellarium format is external and subject to change.

Key function:
- `fetch_constellation_lines()`: Returns `(lines_by_constellation, required_hip_ids)`

---

### `simbad_names.py`
Resolves star names using SIMBAD, with local JSON caching.

Behavior:
- prefers `NAME-IAU`, then `NAME`
- constructs Bayer names using Greek letters + constellation genitives
  - Example: "alf Ori" → "Alpha Orionis"
  - Handles variants: "1 tau Eri" → "Tau1 Eridani"
- caches results to avoid repeated network queries (saves to `names_cache.json`)

Processes in chunks of 500 stars to respect SIMBAD rate limits.

Naming improves UX but is not required for correctness.

Key function:
- `fetch_star_names(hip_ids, cache_path)`: Returns dict of `{HIP: {"p": proper, "b": bayer}}`

---

### `boundaries.py`
Generates official IAU constellation boundaries.

Pipeline:
- download CDS `constbnd.dat` (FK4 / B1875)
- densify boundary segments (interpolate points for smooth curves)
- precess coordinates to J2000 using Astropy (falls back to identity if unavailable)
- output `[RA_hours, Dec_degrees]`

**Densification**: Adds interpolated points along edges to prevent visual gaps when projected to Alt/Az coordinates.

**Precession**: Converts historical B1875 coordinates to modern J2000 epoch. Without Astropy, uses original coordinates (accuracy: ~arcminutes, acceptable for visualization).

Boundaries are optional but visually important.

Key function:
- `generate_boundaries_j2000(data_dir)`: Returns dict of `{constellation_id: [[RA, Dec], ...]}`

---

### `build_pipeline.py`
The orchestration layer and main mental entrypoint.

Steps:
1. load Hipparcos catalog
2. load constellation lines from Stellarium
3. filter stars (bright + line-required stars)
4. assign constellation abbreviations using Skyfield
5. resolve star names via SIMBAD (with caching)
6. generate constellation boundaries with precession
7. write `stars.json`, `lines.json`, `boundaries.json`

**Important:** Right Ascension is written in **hours**, not degrees.
This is required by the Astronomy Engine library used in the frontend.

Key function:
- `build_atlas(output_dir)`: Complete pipeline execution

---

### `cli.py`
Command-line entrypoint.

```bash
python -m atlas_builder.cli --out web
```

Provides a stable interface for local use and automation.

Arguments:
- `--out DIR`: Output directory (default: `web`)
- `--version`: Show version number

---

## Frontend: `web/`

The frontend is a **pure visualization layer**.
It never fetches astronomy data from the network.

### `index.html`
Static HTML shell (layout + CSS + JS module entrypoint).
Contains minimal logic - just structure and style imports.

Key features:
- SVG canvas with clipping paths for horizon
- Layered rendering (grid, boundaries, lines, stars)
- Responsive layout with split-screen (atlas | dashboard)
- Module script import for ES6 modules

---

### `css/styles.css`
All visual styling separated from HTML.

Uses CSS custom properties for theming:
- `--bg-dark`: Background color
- `--accent`: Sky blue accent
- `--star-gold`: Star color for catalog stars
- `--const-pink`: Constellation highlight color

Key animations:
- `.const-line`: 12-second line drawing animation using `stroke-dashoffset`
- `.boundary-path.highlighted`: Pink highlight on hover/focus
- Smooth transitions on star size and opacity

---

### `js/constants.js`
Frontend configuration constants.

Observer location:
- `OBSERVER_LATITUDE`: -36.8485 (Auckland, NZ)
- `OBSERVER_LONGITUDE`: 174.7633
- `OBSERVER_ELEVATION`: 0 meters

SVG geometry:
- `SVG_CENTER`: 500 (center of 1000×1000 canvas)
- `SVG_RADIUS`: 450 (horizon circle)

Constellation mappings:
- `CONSTELLATION_FULL_NAMES`: 3-letter codes → full names
- `normalizeConstellationId()`: Handles variants (Ser1/Ser2 → Ser, PSA → PsA)

Rendering thresholds:
- `MIN_ALTITUDE_DEGREES`: 3.0 (stars below ignored)
- `DEFAULT_MAX_MAGNITUDE`: 5.0
- `FOCUS_MODE_MAGNITUDE`: 6.0 (shows all stars in focus)
- `LINE_WRAP_THRESHOLD`: 400px (detects projection artifacts)

---

### `js/ui.js`
UI-only logic - handles all DOM updates.

No astronomy math lives here.

Key functions:
- `updateStatus(type, message)`: Status indicator (loading/connected/error)
- `updateStarFocusPanel(star)`: Populate star info panel
- `updateConstellationFocusPanel(constId)`: Populate constellation info
- `renderStarTable(stars, onRowHover, onRowLeave)`: Renders top 100 visible stars
- `setLocalTime()`: Initialize time picker to current local time
- `debugLog(message, type)`: Developer console logging

Handles:
- Focus panels (star and constellation info)
- Star table with search filtering
- Time and magnitude controls
- Debug console toggle
- Manual file upload interface

---

### `js/sky_view.js`
Astronomy and rendering engine (the core logic).

#### **State Management**
- `SkyViewState` class: Manages application state
  - Raw catalog data (stars, boundaries, lines)
  - Visible stars and geometry
  - Focus mode state
  - Astronomy Engine observer

#### **Coordinate Transformations**

**Three coordinate systems:**

1. **Equatorial (RA/Dec)**: Celestial coordinates from catalog
2. **Horizontal (Alt/Az)**: Observer-centric coordinates
   - `equatorialToHorizontal(date, raHours, decDegrees)`: Uses Astronomy Engine
3. **SVG (x, y)**: Screen pixel coordinates
   - `projectToSVG(altitude, azimuth)`: Azimuthal equidistant projection

**Projection details:**
- Zenith (90° altitude) → center (500, 500)
- Horizon (0° altitude) → circle edge (radius 450)
- Azimuth 0° (North) → top, 90° (East) → right

#### **Rendering Functions**

**Stars:**
- `renderStars(stars, scaleFactor)`: Creates `<circle>` elements
- Size based on magnitude: `radius = max(1.5, 6 - magnitude)`
- Color: white for proper names, gold for catalog stars
- Opacity scales with magnitude
- In focus mode: 1.5× larger

**Boundaries:**
- `renderBoundaries(date, scaleFactor)`: Creates `<path>` elements for constellation polygons
- `computeBoundarySegments(points, date)`: 
  - Converts RA/Dec → Alt/Az → SVG
  - Detects discontinuities (horizon crossing, RA wraparound)
  - Splits into continuous segments
  - **Adaptive densification**: Interpolates points if screen distance > 20px (prevents gaps)
- Hover interaction: Highlights boundaries in pink

**Constellation Lines:**
- `renderConstellationLines(constId, scaleFactor)`: Creates `<line>` elements
- Only rendered in focus mode
- Wraparound detection: Skips lines > 400px (projection artifacts)
- Animated drawing effect via CSS `stroke-dashoffset`

#### **View Modes**

**Atlas Mode:**
- Full sky view, viewBox `"0 0 1000 1000"`
- Shows all visible stars above MIN_ALTITUDE
- Hover: Preview constellation boundaries
- Click: Enter focus mode

**Focus Mode:**
- Zooms to single constellation
- **Orientation preservation**: 
  - Calculates constellation's average azimuth
  - Rotates view: `rotation = 90 - azimuth`
  - Result: Horizon direction appears at bottom (as if looking at that part of sky)
- ViewBox: Centered on constellation with padding
- Scale factor: Adjusts line/star sizes for zoom level
- Shows constellation lines with draw animation
- Forces magnitude to 6.0 (all stars visible)

**Rotation logic:**
- Azimuth 0° (North) → rotate 90° (north at bottom, as if facing north)
- Azimuth 90° (East) → rotate 0° (east at right, as if facing east)
- Azimuth 180° (South) → rotate -90° (south at bottom, as if facing south)

#### **Interaction Utilities**
- `svgPointFromEvent(evt)`: Mouse → SVG coordinates
- `isInsideHorizon(point)`: Boundary check
- `pointInPolygon(point, polygon)`: Ray casting hit test
- `findConstellationAtPoint(point)`: Identifies constellation under cursor

---

### `js/app.js`
Application bootstrap and controller.

#### **Data Loading**
- Fetches `stars.json`, `boundaries.json`, `lines.json`
- Falls back to manual file picker if auto-load blocked (file:// protocol)
- Initializes Astronomy Engine observer with location

#### **Main Rendering Loop**

`calculateView()` - Called on every update:

1. Get current time and magnitude limit
2. **For each star in catalog:**
   - Convert RA/Dec → Alt/Az (for current time/location)
   - Project Alt/Az → SVG x,y
   - Check if above horizon (altitude ≥ 3°)
   - Check if bright enough (magnitude ≤ limit)
3. **Filter visible stars**
   - Atlas mode: Stars above horizon AND bright enough
   - Focus mode: Stars in constellation (regardless of horizon) AND bright enough
4. **Render based on mode:**
   - `renderAtlasMode(stars, date)`: Full sky view
   - `renderFocusMode(stars, date)`: Zoomed constellation view
5. Update star table with visible objects

#### **Atlas Mode Rendering**
- Reset viewBox to full canvas
- Clear all transforms
- Hide constellation lines
- Render stars and boundaries at 1.0 scale
- Show/hide grid based on toggle

#### **Focus Mode Rendering**
1. Calculate constellation center (average boundary position)
2. Calculate extent (maximum distance from center)
3. Create zoomed viewBox centered on constellation
4. Calculate rotation angle based on azimuth
5. Apply rotation transform to all layers
6. Render with scaled elements
7. Show constellation lines with animation
8. Update focus panel

#### **Event Handlers**
- **Mouse move**: Hit-test boundaries, highlight on hover
- **Click**: Enter focus mode for hovered constellation
- **Table row hover**: Highlight corresponding star on map
- **Time/magnitude change**: Trigger `calculateView()`
- **Grid/boundary toggles**: Show/hide layers

#### **Global Functions** (exposed via `window`)
- `calculateView()`: Refresh view
- `exitConstellationMode()`: Return to atlas
- `handleManualFiles(input)`: Process uploaded JSON files
- `toggleGrid()`: Show/hide coordinate grid
- `filterTable()`: Search star table
- `toggleConsole()`: Show/hide debug log

---

## Generated Data Files

The frontend expects these files next to `index.html`:

| File | Required | Purpose | Size |
|----|----|----|---|
| `stars.json` | Yes | Star positions, magnitudes, names | ~500 KB |
| `lines.json` | Optional | Constellation line segments | ~20 KB |
| `boundaries.json` | Optional | IAU constellation boundaries | ~300 KB |
| `names_cache.json` | No | SIMBAD query cache (build artifact) | Varies |

Missing optional files simply disable those layers.

### Data Format Specifications

**stars.json:**
```json
[
  {
    "id": 25336,
    "p": "Betelgeuse",
    "b": "Alpha Orionis",
    "m": 0.42,
    "r": 5.91953,
    "d": 7.40704,
    "c": "Ori"
  }
]
```
- `id`: Hipparcos catalog number
- `p`: Proper name (null if none)
- `b`: Bayer designation (null if none)
- `m`: Apparent magnitude
- `r`: Right Ascension in **hours** (0-24)
- `d`: Declination in degrees (-90 to +90)
- `c`: Constellation abbreviation

**lines.json:**
```json
{
  "Ori": [[25336, 25428], [25428, 25930], ...],
  "UMa": [[54061, 53910], ...]
}
```
- Key: Constellation ID
- Value: Array of [HIP_ID_1, HIP_ID_2] pairs (line segments)

**boundaries.json:**
```json
{
  "ORI": [[5.5, 10.0], [5.6, 10.1], ...],
  "UMA": [[8.5, 60.0], ...]
}
```
- Key: Constellation ID (uppercase)
- Value: Array of [RA_hours, Dec_degrees] points (polygon vertices)
- Points are J2000 epoch, densified for smooth rendering

---

## Coordinate Conventions

| Quantity | Units | Notes |
|----|----|---|
| Star RA (`r`) | hours (0-24) | Required by Astronomy Engine |
| Star Dec (`d`) | degrees (-90 to +90) | Standard |
| Boundary RA | hours (0-24) | Consistent with stars |
| Boundary Dec | degrees (-90 to +90) | J2000 epoch, ICRS frame |
| Azimuth | degrees (0-360) | 0=N, 90=E, 180=S, 270=W |
| Altitude | degrees (0-90) | 0=horizon, 90=zenith |

**Why hours for RA?**
- Historical astronomy convention (24h = 360° Earth rotation)
- Astronomy Engine library expects hours
- Conversion: `RA_degrees / 15 = RA_hours`

---

## Architecture Principles

### **Separation of Concerns**
- Python: Heavy computation (catalog processing, precession, SIMBAD queries)
- JavaScript: Real-time rendering (time updates every second)
- No runtime coupling: Data files are static

### **Data Flow**
```
Raw Catalogs (Hipparcos, SIMBAD, Stellarium, IAU)
    ↓ Python Pipeline
JSON Files (stars, lines, boundaries)
    ↓ Browser Fetch
JavaScript State (raw data)
    ↓ Astronomy Engine
Transformed Coordinates (Alt/Az → SVG)
    ↓ Rendering
SVG DOM Elements (visible to user)
```

### **Coordinate Transformations**
```
RA/Dec (catalog) → Alt/Az (observer) → x,y (screen)
     ↑                   ↑                   ↑
  J2000 epoch      Time-dependent    Azimuthal projection
```

### **Two-Stage Rendering**
1. **Atlas mode**: Overview, exploration, constellation discovery
2. **Focus mode**: Detail, learning, true sky orientation

### **LLM-Friendly Design**
- Balanced file sizes (150-400 lines per file)
- Explicit dependencies (no magic globals)
- Self-documenting names and rich docstrings
- Type hints in Python for predictability
- Clear separation between modules

---

## Quickstart

```bash
# Install dependencies
pip install -r requirements.txt

# Build atlas data
python -m atlas_builder.cli --out web

# Serve locally
python -m http.server --directory web 8000

# Open browser
open http://localhost:8000
```

**Expected output:**
- `web/stars.json`: ~6,000 stars (magnitude ≤ 6.0 + line stars)
- `web/lines.json`: Constellation stick figures
- `web/boundaries.json`: 88 constellation boundaries
- `web/names_cache.json`: SIMBAD query cache (reused on subsequent builds)

---

## Configuration & Customization

### Change Observer Location
Edit `web/js/constants.js`:
```javascript
export const OBSERVER_LATITUDE = -36.8485;  // Your latitude
export const OBSERVER_LONGITUDE = 174.7633; // Your longitude
```

### Change Constellation Lines Style
Edit `atlas_builder/config.py`:
```python
STELLARIUM_SKYCULTURE = "modern_st"  # Simplified (default)
# or
STELLARIUM_SKYCULTURE = "modern"     # Traditional detailed
```

### Adjust Star Filtering
Edit `atlas_builder/config.py`:
```python
MAX_MAGNITUDE = 6.0  # Include dimmer stars: 6.5, 7.0, etc.
```

### Modify Boundary Smoothness
Edit `atlas_builder/config.py`:
```python
BOUNDARY_DENSIFICATION_STEPS = 10  # Higher = smoother (larger file)
```

---

## Known Limitations & Edge Cases

### Handled Edge Cases
1. **RA wraparound (0h ↔ 24h)**: Boundary splitting logic prevents lines across sky
2. **Serpens constellation split**: Detected as large gap, renders as two regions
3. **Polar regions**: Zenith detection prevents bad azimuth jumps
4. **Constellation line artifacts**: Distance check prevents projection errors
5. **Southern hemisphere**: Works identically (no special casing needed)

### Current Limitations
1. **Mobile support**: Desktop-optimized UI, touch gestures not implemented
2. **Time zones**: Uses browser local time (no explicit timezone selection)
3. **Precession**: Without Astropy, boundaries use B1875 coords (acceptable for visualization)
4. **Performance**: Renders all stars every frame (not virtualized)

---

## Performance Characteristics

**Data sizes:**
- Stars: ~6,000 objects, ~500 KB JSON
- Boundaries: ~15,000 densified points, ~300 KB JSON
- Lines: ~800 segments, ~20 KB JSON

**Rendering:**
- Atlas mode: ~1,000 stars visible (magnitude ≤ 5.0)
- Focus mode: ~50-200 stars per constellation
- Frame rate: 60 FPS on modern hardware
- Initial load: ~1 second (cache enabled)

**Memory:**
- Total bundle: ~1 MB (HTML + CSS + JS + JSON)
- Runtime: ~10-20 MB (DOM + state)

---

## Troubleshooting

**"Auto-load blocked" message:**
- Browser security prevents loading local JSON files
- Use manual file picker or run a local web server

**Constellation lines missing:**
- Ensure `lines.json` exists in `web/` directory
- Check `STELLARIUM_SKYCULTURE` setting in config

**Stars appear at wrong positions:**
- Verify observer location in `constants.js`
- Check system time is correct

**Boundaries have gaps:**
- Increase `BOUNDARY_DENSIFICATION_STEPS` in config
- Check Astropy is installed for accurate precession

**SIMBAD queries failing:**
- Check internet connection
- Cached names in `names_cache.json` will be reused
- Build can complete without names (stars labeled "HIP XXXXX")

---

## Future Enhancements (Not Implemented)

- Mobile-optimized UI with touch gestures
- Pinch-to-zoom and pan in atlas mode
- Location picker with geolocation
- Time-lapse animation (watch sky rotate)
- Deep sky objects (Messier, NGC catalogs)
- Planetary positions (using Astronomy Engine ephemeris)
- Constellation mythology/information panels
- AR mode (point phone at sky, overlay constellations)
- Export current view as image
- Keyboard shortcuts for power users

---

Design goal: explicit data flow, stable schemas, and code that remains understandable
to both humans and LLMs.