/**
 * Sky view rendering and astronomy calculations.
 * 
 * Core responsibilities:
 * - Coordinate transformations (RA/Dec -> Alt/Az -> SVG)
 * - Star, boundary, and constellation line rendering
 * - Interaction handling (hover, click, focus mode)
 * - Constellation hit-testing
 */

import {
    SVG_CENTER,
    SVG_RADIUS,
    OBSERVER_LATITUDE,
    OBSERVER_LONGITUDE,
    OBSERVER_ELEVATION,
    MIN_ALTITUDE_DEGREES,
    FOCUS_MODE_MAGNITUDE,
    LINE_WRAP_THRESHOLD,
    normalizeConstellationId,
    getConstellationDisplayName,
} from './constants.js';

import {
    updateStarFocusPanel,
    updateConstellationFocusPanel,
    clearStarFocusPanel,
    clearConstellationFocusPanel,
    showFocusMode,
    hideFocusMode,
    debugLog,
} from './ui.js';

// ============ State Management ============

/**
 * Sky view application state.
 */
class SkyViewState {
    constructor() {
        this.rawStars = [];           // All stars from catalog
        this.rawBoundaries = {};      // Boundary definitions
        this.rawLines = {};           // Constellation line segments
        this.visibleStars = [];       // Currently rendered stars
        this.starsById = new Map();   // HIP ID -> star geometry (all in view)
        this.constPolys = {};         // Constellation ID -> boundary polygons
        this.focusConstId = null;     // Active constellation in focus mode
        this.lastHoverConst = "";     // Last hovered constellation
        this.observer = null;         // Astronomy Engine Observer
    }
    
    /**
     * Initialize Astronomy Engine observer.
     */
    initObserver() {
        if (typeof Astronomy === 'undefined') {
            throw new Error("Astronomy Engine library not loaded");
        }
        
        this.observer = new Astronomy.Observer(
            OBSERVER_LATITUDE,
            OBSERVER_LONGITUDE,
            OBSERVER_ELEVATION
        );
    }
    
    /**
     * Check if in constellation focus mode.
     */
    isInFocusMode() {
        return this.focusConstId !== null;
    }
    
    /**
     * Enter constellation focus mode.
     */
    enterFocusMode(constId) {
        this.focusConstId = normalizeConstellationId(constId);
        showFocusMode(this.focusConstId);
    }
    
    /**
     * Exit constellation focus mode.
     */
    exitFocusMode() {
        this.focusConstId = null;
        hideFocusMode();
    }
}

// Global state instance
export const skyState = new SkyViewState();

// ============ Coordinate Transformations ============

/**
 * Convert horizontal coordinates (Alt/Az) to SVG coordinates.
 * 
 * Uses azimuthal equidistant projection centered on zenith.
 * South-up orientation: South at top, East on right, West on left.
 * 
 * @param {number} altitude - Altitude in degrees (0 = horizon, 90 = zenith)
 * @param {number} azimuth - Azimuth in degrees (0 = N, 90 = E, 180 = S, 270 = W)
 * @returns {{x: number, y: number}} SVG coordinates
 */
export function projectToSVG(altitude, azimuth) {
    // Radial distance from zenith (center)
    const r = ((90 - altitude) / 90) * SVG_RADIUS;
    
    // South-up orientation: rotate 180° from North-up
    // South at top (azimuth 180° points up), East on right, West on left
    const theta = (270 + azimuth) * Math.PI / 180;
    
    return {
        x: SVG_CENTER + r * Math.cos(theta),
        y: SVG_CENTER - r * Math.sin(theta)
    };
}

/**
 * Convert RA/Dec to Alt/Az for given time and observer.
 * 
 * @param {Date} date - Observation time
 * @param {number} raHours - Right Ascension in hours
 * @param {number} decDegrees - Declination in degrees
 * @returns {{altitude: number, azimuth: number}} Horizontal coordinates
 */
export function equatorialToHorizontal(date, raHours, decDegrees) {
    return Astronomy.Horizon(
        date,
        skyState.observer,
        raHours,
        decDegrees,
        'normal'
    );
}

// ============ Star Rendering ============

/**
 * Render stars to SVG.
 * 
 * @param {Array} stars - Array of star objects with x, y, mag, id, etc.
 * @param {number} scaleFactor - Scale factor for focus mode zoom
 */
export function renderStars(stars, scaleFactor = 1.0) {
    const layer = document.getElementById('starLayer');
    layer.innerHTML = '';
    
    const frag = document.createDocumentFragment();
    
    stars.forEach(s => {
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", s.x);
        circle.setAttribute("cy", s.y);
        
        // Size based on magnitude (brighter = larger)
        let radius = Math.max(1.5, 6 - s.mag);
        if (skyState.isInFocusMode()) radius *= 1.5;
        
        const finalRadius = radius * scaleFactor;
        circle.setAttribute("r", finalRadius);
        circle.dataset.baseR = finalRadius;
        
        // Color: white for proper names, gold for others
        const fillColor = s.proper ? "#ffffff" : "var(--star-gold)";
        circle.setAttribute("fill", fillColor);
        
        // Opacity based on magnitude
        const opacity = Math.max(0.6, 1 - (s.mag / 7));
        circle.setAttribute("opacity", opacity);
        
        circle.classList.add("star-point");
        circle.id = `star-${s.id}`;
        
        // Interaction handlers
        circle.onmouseover = () => highlightStar(s, scaleFactor);
        circle.onmouseout = () => {
            circle.removeAttribute("stroke");
            circle.setAttribute("r", circle.dataset.baseR);
            resetFocus();
        };
        
        frag.appendChild(circle);
    });
    
    layer.appendChild(frag);
}

/**
 * Highlight a star on hover.
 * 
 * @param {Object} star - Star object
 * @param {number} scaleFactor - Current view scale factor
 */
export function highlightStar(star, scaleFactor) {
    // Update focus panel
    updateStarFocusPanel(star);
    
    // Visual highlight
    const el = document.getElementById(`star-${star.id}`);
    if (el) {
        el.setAttribute("stroke", "#38bdf8");
        el.setAttribute("stroke-width", 2 * scaleFactor);
    }
    
    // Trigger constellation hover in atlas mode
    if (!skyState.isInFocusMode() && star.constId) {
        skyState.lastHoverConst = normalizeConstellationId(star.constId);
        highlightConstellation(star.constId);
    }
}

// ============ Constellation Rendering ============

/**
 * Render constellation boundaries to SVG.
 * 
 * @param {Date} date - Current observation time
 * @param {number} scaleFactor - Scale factor for focus mode
 */
export function renderBoundaries(date, scaleFactor = 1.0) {
    const layer = document.getElementById('boundaryLayer');
    layer.innerHTML = '';
    
    const frag = document.createDocumentFragment();
    skyState.constPolys = {};
    
    for (const [rawKey, points] of Object.entries(skyState.rawBoundaries)) {
        const constId = normalizeConstellationId(rawKey);
        
        // Skip non-focused constellations in focus mode
        if (skyState.isInFocusMode() && constId !== skyState.focusConstId) {
            continue;
        }
        
        const segments = computeBoundarySegments(points, date);
        
        segments.forEach(segment => {
            const path = createBoundaryPath(segment, constId);
            frag.appendChild(path);
            
            // Store polygon for hit-testing
            if (!skyState.constPolys[constId]) {
                skyState.constPolys[constId] = [];
            }
            skyState.constPolys[constId].push(segment);
        });
    }
    
    layer.appendChild(frag);
}

/**
 * Compute boundary segments with wraparound handling.
 * 
 * Splits boundaries at discontinuities (e.g., crossing horizon).
 * 
 * @param {Array} points - Raw boundary points [[RA, Dec], ...]
 * @param {Date} date - Observation time
 * @returns {Array} Array of continuous segments
 */
function computeBoundarySegments(points, date) {
    const segments = [];
    let currentSegment = [];
    let lastPt = null;
    let lastAz = null;
    
    const flushSegment = () => {
        if (currentSegment.length >= 3) {
            segments.push([...currentSegment]);
        }
        currentSegment = [];
    };
    
    for (const [raHours, decDegrees] of points) {
        const hor = equatorialToHorizontal(date, raHours, decDegrees);
        
        // Skip points below horizon
        if (hor.altitude < -10) {
            lastPt = null;
            continue;
        }
        
        const pt = projectToSVG(hor.altitude, hor.azimuth);
        
        // Detect discontinuities
        let startNew = false;
        if (lastPt) {
            const dist = Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y);
            const isNearZenith = hor.altitude > 80;
            
            let azJump = 0;
            if (lastAz !== null) {
                azJump = Math.abs(hor.azimuth - lastAz);
                if (azJump > 180) azJump = 360 - azJump;
            }
            
            if (dist > 300 || (!isNearZenith && azJump > 90)) {
                startNew = true;
            }
        }
        
        if (startNew) flushSegment();
        
        currentSegment.push(pt);
        lastPt = pt;
        lastAz = hor.azimuth;
    }
    
    flushSegment();
    return segments;
}

/**
 * Create SVG path element for boundary segment.
 * 
 * @param {Array} segment - Array of {x, y} points
 * @param {string} constId - Constellation ID
 * @returns {SVGPathElement} SVG path element
 */
function createBoundaryPath(segment, constId) {
    let pathData = "";
    segment.forEach((pt, i) => {
        pathData += (i === 0) ? `M ${pt.x} ${pt.y}` : ` L ${pt.x} ${pt.y}`;
    });
    
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.classList.add("boundary-path");
    path.dataset.const = constId;
    
    // Auto-highlight in focus mode
    if (skyState.isInFocusMode() && constId === skyState.focusConstId) {
        path.classList.add("highlighted");
    } else if (!skyState.isInFocusMode()) {
        // Add hover listener in atlas mode
        path.addEventListener('mouseenter', () => {
            skyState.lastHoverConst = constId;
            highlightConstellation(constId);
        });
    }
    
    return path;
}

/**
 * Render constellation stick figures.
 * 
 * @param {string} constId - Constellation to render
 * @param {number} scaleFactor - Scale factor for line thickness
 */
export function renderConstellationLines(constId, scaleFactor) {
    const layer = document.getElementById('linesLayer');
    layer.innerHTML = '';
    
    // Collect all line pairs for this constellation
    let pairs = [];
    for (const [key, lines] of Object.entries(skyState.rawLines)) {
        if (normalizeConstellationId(key) === constId) {
            pairs = pairs.concat(lines);
        }
    }
    
    if (pairs.length === 0) return;
    
    const frag = document.createDocumentFragment();
    
    pairs.forEach(([hipA, hipB]) => {
        const s1 = skyState.starsById.get(parseInt(hipA));
        const s2 = skyState.starsById.get(parseInt(hipB));
        
        if (!s1 || !s2) return;
        
        // Check for wraparound artifacts
        const dx = s1.x - s2.x;
        const dy = s1.y - s2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist >= LINE_WRAP_THRESHOLD * scaleFactor) return;
        
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", s1.x);
        line.setAttribute("y1", s1.y);
        line.setAttribute("x2", s2.x);
        line.setAttribute("y2", s2.y);
        line.setAttribute("stroke", "white");
        line.classList.add("const-line");
        line.style.strokeWidth = `${1.5 * scaleFactor}px`;
        
        frag.appendChild(line);
    });
    
    layer.appendChild(frag);
}

// ============ Focus Management ============

/**
 * Highlight constellation boundaries.
 * 
 * @param {string} constIdRaw - Constellation ID (will be normalized)
 */
export function highlightConstellation(constIdRaw) {
    const constId = normalizeConstellationId(constIdRaw);
    
    updateConstellationFocusPanel(constId);
    
    // Remove previous highlights
    document.querySelectorAll('.boundary-path').forEach(el => {
        el.classList.remove('highlighted');
    });
    
    // Add highlight to matching boundaries
    document.querySelectorAll(`.boundary-path[data-const="${constId}"]`).forEach(el => {
        el.classList.add('highlighted');
    });
}

/**
 * Reset all focus highlighting.
 */
export function resetFocus() {
    clearStarFocusPanel();
    
    // Remove star highlights
    document.querySelectorAll('.star-point').forEach(el => {
        el.removeAttribute("stroke");
        el.setAttribute("r", el.dataset.baseR);
    });
    
    // Handle constellation panel based on mode
    if (skyState.isInFocusMode()) {
        // Keep constellation panel and highlight active
        updateConstellationFocusPanel(skyState.focusConstId);
        
        const paths = document.querySelectorAll(
            `.boundary-path[data-const="${skyState.focusConstId}"]`
        );
        paths.forEach(el => el.classList.add('highlighted'));
    } else {
        // Clear constellation panel in atlas mode
        clearConstellationFocusPanel();
        document.querySelectorAll('.boundary-path').forEach(el => {
            el.classList.remove('highlighted');
        });
        skyState.lastHoverConst = "";
    }
}

// ============ Interaction Utilities ============

/**
 * Convert mouse event to SVG coordinates.
 * 
 * @param {MouseEvent} evt - Mouse event
 * @returns {{x: number, y: number}|null} SVG point or null
 */
export function svgPointFromEvent(evt) {
    const svg = document.getElementById('skyCanvas');
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    
    return pt.matrixTransform(matrix.inverse());
}

/**
 * Check if point is inside horizon circle.
 * 
 * @param {{x: number, y: number}} point - SVG coordinates
 * @returns {boolean} True if inside horizon
 */
export function isInsideHorizon(point) {
    const dx = point.x - SVG_CENTER;
    const dy = point.y - SVG_CENTER;
    return (dx * dx + dy * dy) <= (SVG_RADIUS * SVG_RADIUS);
}

/**
 * Point-in-polygon test using ray casting algorithm.
 * 
 * @param {{x: number, y: number}} point - Test point
 * @param {Array} polygon - Array of {x, y} points
 * @returns {boolean} True if point is inside polygon
 */
export function pointInPolygon(point, polygon) {
    let inside = false;
    
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;
        
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || 1e-9) + xi);
        
        if (intersect) inside = !inside;
    }
    
    return inside;
}

/**
 * Find constellation at given SVG coordinates.
 * 
 * @param {{x: number, y: number}} point - SVG coordinates
 * @returns {string|null} Constellation ID or null
 */
export function findConstellationAtPoint(point) {
    for (const [constId, polygons] of Object.entries(skyState.constPolys)) {
        for (const poly of polygons) {
            if (pointInPolygon(point, poly)) {
                return constId;
            }
        }
    }
    return null;
}