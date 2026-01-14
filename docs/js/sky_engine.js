/**
 * Sky calculation engine.
 * 
 * Responsibilities:
 * - State management (SkyViewState)
 * - Coordinate transformations (RA/Dec <-> Alt/Az <-> SVG)
 * - View calculation (filtering, processing stars)
 * - Observer initialization
 * - Point-in-polygon testing for constellation boundaries
 */

import {
    SVG_CENTER,
    SVG_RADIUS,
    OBSERVER_LATITUDE,
    OBSERVER_LONGITUDE,
    OBSERVER_ELEVATION,
    MIN_ALTITUDE_DEGREES,
    normalizeConstellationId,
} from './constants.js';

import {
    getCurrentTime,
    getCurrentMagnitudeLimit,
    debugLog,
} from './ui.js';

// ============ State Management ============

/**
 * Sky view application state.
 */
class SkyViewState {
    constructor() {
        this.rawStars = [];
        this.rawBoundaries = {};
        this.rawLines = {};
        this.visibleStars = [];
        this.starsById = new Map();
        this.boundaryPolygons = new Map();
        this.observer = null;
        this.transform = { x: 0, y: 0, k: 1 };
        this.lastHighlightedStarId = null;
        this.lastHighlightedConstId = null;
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
     * Update transform and apply to DOM.
     */
    setTransform(x, y, k) {
        this.transform = { x, y, k };
        const group = document.getElementById('cameraGroup');
        if (group) {
            group.setAttribute('transform', `translate(${x}, ${y}) scale(${k})`);

            const starGrowth = Math.pow(k, 0.4);
            group.style.setProperty('--zoom-growth', starGrowth);
        }

        // Dynamic Opacity for Lines
        const linesLayer = document.getElementById('linesLayer');
        if (linesLayer) {
            let opacity = 0;
            if (k > 1.5) {
                opacity = Math.min(1, (k - 1.5) / 1.5);
            }
            linesLayer.style.opacity = opacity;
            linesLayer.style.display = opacity > 0.01 ? 'block' : 'none';
        }
    }
}

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
    const r = ((90 - altitude) / 90) * SVG_RADIUS;
    const theta = (270 + azimuth) * Math.PI / 180;

    return {
        x: SVG_CENTER + r * Math.cos(theta),
        y: SVG_CENTER - r * Math.sin(theta)
    };
}

/**
 * Convert SVG coordinates to horizontal coordinates (Alt/Az).
 * Inverse of projectToSVG.
 * 
 * @param {number} x - SVG x coordinate
 * @param {number} y - SVG y coordinate
 * @returns {{altitude: number, azimuth: number}}
 */
export function svgToHorizontal(x, y) {
    const dx = x - SVG_CENTER;
    const dy = SVG_CENTER - y;

    const r = Math.sqrt(dx * dx + dy * dy);
    let theta = Math.atan2(dy, dx);

    let azimuth = (theta * 180 / Math.PI) - 270;

    while (azimuth < 0) azimuth += 360;
    while (azimuth >= 360) azimuth -= 360;

    const altitude = 90 - (90 * r / SVG_RADIUS);

    return { altitude, azimuth };
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

/**
 * Convert Horizontal (Alt/Az) to Equatorial (RA/Dec).
 * 
 * @param {Date} date - Observation time
 * @param {number} altitude - Altitude in degrees
 * @param {number} azimuth - Azimuth in degrees
 * @returns {{ra: number, dec: number}} Equatorial coordinates (ra in hours, dec in degrees)
 */
export function horizontalToEquatorial(date, altitude, azimuth) {
    return Astronomy.Equator(
        skyState.observer,
        date,
        altitude,
        azimuth,
        'normal'
    );
}

// ============ Point-in-Polygon Testing ============

/**
 * Ray casting algorithm for point-in-polygon test.
 * Works in any coordinate space (SVG, RA/Dec, etc.)
 * 
 * @param {Object} point - {x, y}
 * @param {Array} polygon - [{x, y}, {x, y}, ...]
 * @returns {boolean}
 */
export function pointInPolygon(point, polygon) {
    if (!polygon || polygon.length < 3) return false;
    
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;
        
        const intersect = ((yi > point.y) !== (yj > point.y))
            && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        
        if (intersect) inside = !inside;
    }
    return inside;
}

/**
 * Find which constellation a point is inside.
 * Tests all boundary polygons and returns the constellation ID if found.
 * 
 * @param {number} x - SVG x coordinate
 * @param {number} y - SVG y coordinate
 * @returns {string|null} Constellation ID or null
 */
export function findConstellationAtPoint(x, y) {
    const point = { x, y };
    
    // Test each constellation boundary polygon
    for (const [constId, polygon] of skyState.boundaryPolygons.entries()) {
        if (pointInPolygon(point, polygon)) {
            return constId;
        }
    }
    
    return null;
}

// ============ View Calculation ============

/**
 * Calculate current sky view - process all stars and determine visibility.
 * Does NOT render - just updates skyState with calculated data.
 */
export function calculateView() {
    if (skyState.rawStars.length === 0) {
        debugLog("No star data loaded", "warn");
        return;
    }

    const date = getCurrentTime();
    const sliderMag = getCurrentMagnitudeLimit();

    // Reset state
    skyState.visibleStars = [];
    skyState.starsById.clear();

    // Process all stars
    for (const rawStar of skyState.rawStars) {
        const hor = equatorialToHorizontal(date, rawStar.r, rawStar.d);
        const pt = projectToSVG(hor.altitude, hor.azimuth);

        const properName = rawStar.p || null;
        const bayerName = rawStar.b || null;
        const displayName = properName || bayerName || `HIP ${rawStar.id}`;

        const star = {
            id: rawStar.id,
            name: displayName,
            bayer: bayerName,
            proper: properName,
            mag: rawStar.m,
            constId: normalizeConstellationId(rawStar.c),
            alt: hor.altitude,
            az: hor.azimuth,
            x: pt.x,
            y: pt.y
        };

        const inView = (star.alt >= MIN_ALTITUDE_DEGREES);

        if (inView) {
            skyState.starsById.set(rawStar.id, star);
            if (star.mag <= sliderMag) {
                skyState.visibleStars.push(star);
            }
        }
    }

    // Sort by magnitude (brightest first)
    skyState.visibleStars.sort((a, b) => a.mag - b.mag);

    debugLog(`Calculated ${skyState.visibleStars.length} visible stars`, "info");
}