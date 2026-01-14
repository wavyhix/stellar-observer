# Stellar Observer (Atlas)

An interactive sky atlas that renders real-time views of the night sky with constellation boundaries, star positions, and interactive zoom/pan capabilities.

Stellar Observer consists of two cleanly separated parts:

1. **Python data builder** — generates static JSON datasets (stars, lines, boundaries).
2. **Static web frontend** — renders an interactive sky atlas from those datasets.

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

### Architecture Overview

The frontend uses a modular ES6 architecture with clear separation of concerns:

```
app.js           → Application bootstrap, event handlers, orchestration
constants.js     → Configuration, observer location, constellation mappings
sky_engine.js    → Coordinate transformations, state management, calculations
rendering.js     → All SVG/DOM manipulation, visual output
ui.js            → UI panels, controls, status messages
```

---

### `index.html`
Static HTML shell (layout + CSS + JS module entrypoint).
Contains minimal logic - just structure and style imports.

Key features:
- SVG canvas with clipping paths for horizon circle
- Layered rendering architecture:
  - `gridLayer`: Compass directions (N/S/E/W)
  - `boundaryLayer`: IAU constellation boundaries
  - `linesLayer`: Constellation stick figures
  - `starLayer`: Individual star points
- Responsive split-screen layout (atlas | dashboard)
- Camera transform group for pan/zoom
- Module script import for ES6 modules

---

### `css/styles.css`
All visual styling separated from HTML.

Uses CSS custom properties for theming:
- `--bg-dark`: Background color
- `--accent`: Sky blue accent
- `--star-gold`: Star color for catalog stars
- `--const-pink`: Constellation highlight color

Key styling features:
- `.boundary-path`: Constellation boundaries with hover highlights
- `.const-line`: Animated line drawing using `stroke-dashoffset`
- `.star-point`: Star rendering with hover transitions
- `.focus-panel`: Active state styling for info panels
- GPU-accelerated transforms for smooth pan/zoom

---

### `js/constants.js`
Frontend configuration constants.

**Observer Location:**
- `OBSERVER_LATITUDE`: -36.8485 (Auckland, NZ)
- `OBSERVER_LONGITUDE`: 174.7633
- `OBSERVER_ELEVATION`: 0 meters

**SVG Geometry:**
- `SVG_CENTER`: 500 (center of 1000×1000 canvas)
- `SVG_RADIUS`: 450 (horizon circle)

**Constellation Mappings:**
- `CONSTELLATION_FULL_NAMES`: 3-letter codes → full names
- `normalizeConstellationId()`: Handles variants (Ser1/Ser2 → Ser, PSA → PsA)
- `getConstellationDisplayName()`: Returns full name with fallback

**Rendering Thresholds:**
- `MIN_ALTITUDE_DEGREES`: 3.0 (stars below horizon ignored)
- `DEFAULT_MAX_MAGNITUDE`: 5.0
- `LINE_WRAP_THRESHOLD`: 400px (detects projection artifacts)
- `BOUNDARY_GAP_THRESHOLD`: 300px (boundary segment splitting)

---

### `js/ui.js`
UI-only logic - handles all DOM updates without astronomy calculations.

**Status Management:**
- `updateStatus(type, message)`: Status indicator (loading/connected/error)
- `showManualLoadPrompt()`: Display file picker for blocked auto-load
- `hideManualLoadPrompt()`: Remove file picker when data loads

**Focus Panels:**
- `updateStarFocusPanel(star)`: Populate star info (name, magnitude, position)
- `updateConstellationFocusPanel(constId)`: Populate constellation info
- `clearStarFocusPanel()`: Reset star panel to default state
- `clearConstellationFocusPanel()`: Reset constellation panel

**Controls:**
- `setLocalTime()`: Initialize time picker to 10 PM local time
- `getCurrentTime()`: Read current time from datetime picker
- `getCurrentMagnitudeLimit()`: Read magnitude filter value

**Debug Console:**
- `debugLog(message, type)`: Developer console with color coding
- `toggleConsole(forceOpen)`: Show/hide debug output

---

### `js/sky_engine.js`
Core astronomy calculations and state management.

**State Management:**
- `SkyViewState` class: Central application state
  - `rawStars`, `rawBoundaries`, `rawLines`: Loaded catalog data
  - `visibleStars`: Filtered and processed stars for current view
  - `starsById`: Map for quick star lookup by HIP ID
  - `observer`: Astronomy Engine observer object
  - `transform`: Camera state `{x, y, k}` for pan/zoom
  - `lastHighlightedStarId`: Hover state tracking

**Coordinate Transformations:**
- `projectToSVG(altitude, azimuth)`: Maps Alt/Az → SVG coordinates
  - Azimuthal equidistant projection centered on zenith
  - South-up orientation (South at top, consistent with Auckland view)
- `svgToHorizontal(x, y)`: Inverse projection SVG → Alt/Az
- `equatorialToHorizontal(date, ra, dec)`: RA/Dec → Alt/Az using Astronomy Engine
- `horizontalToEquatorial(date, alt, az)`: Alt/Az → RA/Dec (for sky queries)

**View Calculation:**
- `calculateView()`: Main calculation pipeline
  1. Get current time and magnitude limit
  2. Transform all stars from RA/Dec → Alt/Az → SVG
  3. Filter by horizon (altitude ≥ 3°) and magnitude
  4. Build `starsById` map for constellation line rendering
  5. Sort by magnitude (brightest first)
  6. Does NOT render - only updates state

**Transform Management:**
- `setTransform(x, y, k)`: Update camera position and apply to DOM
  - Updates SVG transform attribute for smooth pan/zoom
  - Dynamically adjusts star size scaling (`--zoom-growth`)
  - Controls constellation line opacity (fades in at k > 1.5)

---

### `js/rendering.js`
All SVG and DOM manipulation - the visual output layer.

**Main Render Function:**
- `renderView()`: Complete rendering pipeline
  1. Render stars with magnitude-based sizing
  2. Render constellation boundaries with wraparound handling
  3. Render constellation lines with distance filtering
  4. Update layer visibility based on toggles
  5. Refresh star table

**Star Rendering:**
- `renderStars(stars)`: Create SVG line elements for stars
  - Uses `<line>` with `stroke-linecap="round"` for circular appearance
  - Dynamic sizing based on magnitude (brighter = larger)
  - White color for proper names, gold for catalog stars
  - Hover handlers for highlighting and info panels
  - Scale adjustment via CSS custom property for zoom

**Boundary Rendering:**
- `renderBoundaries(date)`: Draw IAU constellation boundaries
- `computeBoundarySegments(points, date)`: Smart segmentation
  - Detects RA wraparound (0h ↔ 24h) using distance thresholds
  - Handles zenith discontinuities with azimuth jump detection
  - Splits boundaries into continuous segments
- `createBoundaryPath(segment, constId)`: Generate SVG path elements

**Constellation Lines:**
- `renderConstellationLines()`: Draw stick figures
  - Connects stars by HIP ID pairs from `lines.json`
  - Distance filtering prevents wraparound artifacts (> 400px = skip)
  - Uses `vector-effect: non-scaling-stroke` for consistent width
  - Animated line drawing with `stroke-dasharray` CSS
  - Opacity controlled by zoom level (hidden at k ≤ 1.5)

**Star Table:**
- `renderStarTable()`: Populate visible stars list
  - Search filtering by name, Bayer designation, constellation
  - Live star count display
  - Row hover triggers star highlighting on map
  - Formatted magnitude, altitude/azimuth display

**Highlight System:**
- `highlightStar(star)`: Emphasize star on hover
  - Change color to sky blue
  - Scale up using CSS transform (prevents layout shift)
  - Update info panels with star and constellation data
- `resetFocus()`: Clear all highlights and info panels

---

### `js/app.js`
Application bootstrap, event handlers, and main controller.

**Data Loading:**
- `loadData()`: Asynchronous JSON file loading
  - Attempts auto-load via fetch (blocked in `file://` protocol)
  - Graceful fallback to manual file picker
  - Status updates and debug logging
- `handleManualFiles(files)`: Process user-uploaded JSON files
  - FileReader API for local file reading
  - Intelligent filename detection (stars/boundaries/lines)

**Interactive Camera:**
- **Wheel Handler**: Zoom towards cursor position
  - Exponential scaling for smooth feel
  - Zoom limits: 1.0x (full view) to 5.0x (deep zoom)
  - Circular bounds enforcement to prevent panning outside horizon
- **Mouse Drag**: Pan the sky view
  - Only active when zoomed (k > 1.01)
  - Tracks drag delta and applies to transform
  - Cursor changes: `grab` ↔ `grabbing`
  - Circular bounds prevent escaping visible area

**Circular Bounds:**
- `applyCircularBounds(x, y, k)`: Constraint enforcement
  - Calculates viewport center in world space
  - Measures distance from atlas center
  - Clamps to effective radius (shrinks as you zoom)
  - Prevents "empty space" viewing

**Grid Management:**
- `drawGrid()`: Render compass directions (N/S/E/W)
  - Static background layer with horizon circle
  - Cardinal direction labels at circle edge
- `toggleGrid()`: Show/hide grid layer

**Global Functions:**
- `window.calculateView`: Exposed for refresh button
- `window.adjustMagnitude(delta)`: ±1 magnitude control with debouncing
- `window.adjustTime(deltaHours)`: Time offset controls (±1 hour)
- `window.filterTable`: Exposed for search input
- `window.toggleConsole`: Debug console toggle

**Initialization:**
- Checks for Astronomy Engine library
- Creates observer object for location
- Loads data and renders initial view
- Attaches all event listeners
- Sets up layer toggle handlers

---

## Generated Data Files

The frontend expects these files next to `index.html`:

| File | Required | Purpose | Size |
|------|----------|---------|------|
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
|----------|-------|-------|
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

**Projection Details:**
- Azimuthal equidistant projection (like looking up at the sky)
- Zenith at center, horizon at edge
- South-up orientation (South at top for Southern Hemisphere observers)
- Distance from center = (90° - altitude) / 90° × radius

---

## Architecture Principles

### **Separation of Concerns**
- Python: Heavy computation (catalog processing, precession, SIMBAD queries)
- JavaScript: Real-time rendering (60 FPS interaction, time updates)
- No runtime coupling: Data files are static, no server required

### **Data Flow**
```
Raw Catalogs (Hipparcos, SIMBAD, Stellarium, IAU)
    ↓ Python Pipeline
JSON Files (stars, lines, boundaries)
    ↓ Browser Fetch
JavaScript State (skyState object)
    ↓ Astronomy Engine + calculateView()
Transformed Coordinates (Alt/Az → SVG)
    ↓ renderView()
SVG DOM Elements (visible to user)
```

### **Coordinate Transformations**
```
RA/Dec (catalog) → Alt/Az (observer) → x,y (screen)
     ↓                   ↓                   ↓
  J2000 epoch      Time-dependent    Azimuthal projection
                   Observer-dependent  (South-up orientation)
```

### **Camera System**
- **World Space**: Fixed 1000×1000 SVG coordinate system (stars, boundaries, lines)
- **Camera Transform**: `translate(x, y) scale(k)` applied to container group
- **Zoom Range**: 1.0x (full sky) to 5.0x (detailed view)
- **Circular Bounds**: Prevents panning outside visible horizon circle
- **Dynamic Scaling**: Stars and lines adjust size/opacity based on zoom level

### **Rendering Strategy**
- **Single View Mode**: No separate atlas/focus modes (simplified from original design)
- **Layer Visibility**:
  - Grid: Toggle-able compass overlay
  - Boundaries: Toggle-able, always rendered when enabled
  - Lines: Dynamically fade in during zoom (k > 1.5)
  - Stars: Always visible, size scales with zoom
- **Performance**: Full re-render on time/magnitude changes, transform-only on pan/zoom

### **LLM-Friendly Design**
- Balanced file sizes (150-400 lines per file)
- Explicit dependencies (ES6 imports, no magic globals)
- Self-documenting names and rich docstrings
- Clear separation between modules (calculation vs rendering vs UI)
- Minimal coupling (modules communicate via skyState)

---

## Quickstart

```bash
# Install dependencies
pip install -r requirements.txt

# Build atlas data
python -m atlas_builder.cli --out web

# Serve locally (required for auto-load to work)
python -m http.server --directory web 8000

# Open browser
open http://localhost:8000
```

**Expected output:**
- `web/stars.json`: ~6,000 stars (magnitude ≤ 6.0 + line stars)
- `web/lines.json`: Constellation stick figures
- `web/boundaries.json`: 88 constellation boundaries
- `web/names_cache.json`: SIMBAD query cache (reused on subsequent builds)

**First-time build notes:**
- SIMBAD queries may take 5-10 minutes (cached for future builds)
- Internet connection required for downloads
- Astropy recommended for accurate boundary precession

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
1. **RA wraparound (0h ↔ 24h)**: Boundary distance checks prevent lines across sky
2. **Serpens constellation split**: Large gap detection renders as two regions
3. **Polar regions**: Azimuth jump detection prevents bad boundary segments
4. **Constellation line artifacts**: Distance threshold prevents projection errors (>400px)
5. **Southern hemisphere**: Works identically (South-up orientation is natural)
6. **Zoom bounds**: Circular constraint prevents panning outside horizon
7. **File protocol blocks**: Graceful fallback to manual file picker

### Current Limitations
1. **Mobile support**: Desktop-optimized UI, touch gestures not implemented
2. **Time zones**: Uses browser local time (no explicit timezone selection)
3. **Precession**: Without Astropy, boundaries use B1875 coords (acceptable for visualization)
4. **Performance**: Re-renders all elements on view changes (not virtualized)
5. **Orientation**: Fixed South-up view (no rotation controls)
6. **Deep sky objects**: Only stars from Hipparcos catalog
7. **Planets**: Not included (would require ephemeris calculations)

---

## Performance Characteristics

**Data sizes:**
- Stars: ~6,000 objects, ~500 KB JSON
- Boundaries: ~15,000 densified points, ~300 KB JSON
- Lines: ~800 segments, ~20 KB JSON

**Rendering:**
- Visible stars: ~1,000 (magnitude ≤ 5.0 default)
- Frame rate: 60 FPS on modern hardware
- Initial load: ~1 second (with cache enabled)
- Pan/zoom: GPU-accelerated CSS transforms

**Memory:**
- Total bundle: ~1 MB (HTML + CSS + JS + JSON)
- Runtime: ~10-20 MB (DOM + state)

**Browser compatibility:**
- Modern browsers with ES6 module support
- Chrome 61+, Firefox 60+, Safari 11+, Edge 79+
- Astronomy Engine: IE11 not supported

---

## Troubleshooting

**"Auto-load blocked" message:**
- Browser security prevents loading local JSON files via `file://` protocol
- **Solution**: Use manual file picker or run a local web server
- Recommended: `python -m http.server --directory web 8000`

**Constellation lines missing:**
- Ensure `lines.json` exists in `web/` directory
- Check `STELLARIUM_SKYCULTURE` setting in config
- Verify lines fade in when zoomed (k > 1.5)

**Stars appear at wrong positions:**
- Verify observer location in `constants.js`
- Check system time is correct (browser uses local time)
- Ensure Astronomy Engine library loaded (check browser console)

**Boundaries have gaps:**
- Increase `BOUNDARY_DENSIFICATION_STEPS` in config
- Check Astropy is installed for accurate precession
- Gaps near zenith are normal for some constellations

**SIMBAD queries failing:**
- Check internet connection
- Cached names in `names_cache.json` will be reused
- Build can complete without names (stars labeled "HIP XXXXX")

**Pan/zoom not working:**
- Check browser console for JavaScript errors
- Verify SVG `cameraGroup` element exists
- Ensure wheel event listener attached (check with DevTools)

**Slow performance:**
- Reduce `MAX_MAGNITUDE` to show fewer stars
- Check browser hardware acceleration is enabled
- Try disabling constellation lines/boundaries

---

## Future Enhancements (Not Implemented)

**User Experience:**
- Mobile-optimized UI with touch gestures
- Pinch-to-zoom and two-finger pan
- Location picker with geolocation API
- Time-lapse animation (watch sky rotate)
- North-up/South-up orientation toggle
- Keyboard shortcuts for power users

**Content:**
- Deep sky objects (Messier, NGC catalogs)
- Planetary positions (using Astronomy Engine ephemeris)
- Solar system objects (Moon, Sun, visible planets)
- Constellation mythology/information panels
- Star labels at high zoom levels

**Features:**
- AR mode (overlay on phone camera)
- Export current view as image/PDF
- Custom observer locations per-session
- Telescope control integration
- Light pollution overlay
- Cloud cover warnings

**Technical:**
- WebGL rendering for 10,000+ stars
- Virtualized star table (render only visible rows)
- Service worker for offline use
- Progressive Web App (PWA) support
- Internationalization (i18n)

---

## Design Philosophy

**Explicit over implicit:**
- Clear data flow, stable schemas
- No hidden state or magic globals
- Dependencies declared via ES6 imports

**Separation of concerns:**
- Each module has a single, well-defined responsibility
- Astronomy calculations isolated from rendering
- UI updates isolated from data processing

**LLM-friendly codebase:**
- Rich documentation and inline comments
- Self-describing function and variable names
- Consistent patterns across modules
- Predictable file structure

**Performance by design:**
- GPU-accelerated transforms for pan/zoom
- Efficient SVG rendering with `vector-effect`
- Minimal DOM updates during interaction
- Lazy-loaded constellation lines (zoom-dependent)

**Goal**: Code that remains understandable to both humans and LLMs, with clean boundaries and predictable behavior.

---

## License & Attribution

**Data Sources:**
- Hipparcos Catalog: ESA, via Skyfield
- SIMBAD: CDS, Strasbourg
- Stellarium Constellation Lines: Stellarium Astronomy Software (GPL)
- IAU Constellation Boundaries: CDS `constbnd.dat`

**Libraries:**
- Astronomy Engine (Eric Dose): MIT License
- Skyfield (Brandon Rhodes): MIT License
- Astropy: BSD 3-Clause License

This project is provided as-is for educational and personal use.