/**
 * Application bootstrap and main controller.
 * 
 * Responsibilities:
 * - Load JSON data files
 * - Initialize UI and event handlers
 * - Coordinate view calculations and rendering
 */

import {
    SVG_CENTER,
    SVG_RADIUS,
    MIN_ALTITUDE_DEGREES,
    FOCUS_MODE_MAGNITUDE,
    normalizeConstellationId,
} from './constants.js';

import {
    updateStatus,
    showManualLoadPrompt,
    hideManualLoadPrompt,
    setLocalTime,
    updateMagnitudeLabel,
    getCurrentTime,
    getCurrentMagnitudeLimit,
    renderStarTable,
    debugLog,
    toggleConsole,
    clearStarFocusPanel,
    clearConstellationFocusPanel,
    updateConstellationFocusPanel,
} from './ui.js';

import {
    skyState,
    projectToSVG,
    equatorialToHorizontal,
    renderStars,
    renderBoundaries,
    renderConstellationLines,
    resetFocus,
    highlightConstellation,
    svgPointFromEvent,
    isInsideHorizon,
    findConstellationAtPoint,
    highlightStar,
} from './sky_view.js';

// ============ Data Loading ============

/**
 * Load all JSON data files.
 * 
 * @returns {Promise<void>}
 */
async function loadData() {
    try {
        // Check for file:// protocol
        if (window.location.protocol === 'file:') {
            throw new Error("Local file protocol not supported");
        }
        
        updateStatus('loading', 'Loading data...');
        
        const [starsRes, boundariesRes, linesRes] = await Promise.all([
            fetch('stars.json'),
            fetch('boundaries.json'),
            fetch('lines.json').catch(() => ({ ok: false }))
        ]);
        
        if (!starsRes.ok || !boundariesRes.ok) {
            throw new Error("Required files not found");
        }
        
        skyState.rawStars = await starsRes.json();
        skyState.rawBoundaries = await boundariesRes.json();
        
        if (linesRes.ok) {
            skyState.rawLines = await linesRes.json();
            debugLog("Loaded constellation lines", "success");
        } else {
            debugLog("Constellation lines not available", "warn");
        }
        
        updateStatus('connected', 'Ready');
        debugLog(`Loaded ${skyState.rawStars.length} stars`, "success");
        
    } catch (error) {
        debugLog(`Auto-load failed: ${error.message}`, "error");
        updateStatus('error', 'Auto-load blocked');
        showManualLoadPrompt();
        throw error;
    }
}

/**
 * Handle manual file upload.
 * 
 * @param {FileList} files - Selected files from input
 */
export function handleManualFiles(files) {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;
    
    updateStatus('loading', 'Parsing files...');
    
    fileArray.forEach(file => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                const name = file.name.toLowerCase();
                
                if (name.includes("stars")) {
                    skyState.rawStars = json;
                } else if (name.includes("boundaries")) {
                    skyState.rawBoundaries = json;
                } else if (name.includes("lines")) {
                    skyState.rawLines = json;
                }
                
                // Check if all required files loaded
                if (skyState.rawStars.length && Object.keys(skyState.rawBoundaries).length) {
                    hideManualLoadPrompt();
                    updateStatus('connected', 'Manual load successful');
                    calculateView();
                }
                
            } catch (err) {
                debugLog(`Parse error: ${err.message}`, "error");
            }
        };
        
        reader.readAsText(file);
    });
}

// ============ View Calculation ============

/**
 * Calculate and render current sky view.
 * 
 * Main rendering pipeline:
 * 1. Get current time and magnitude limit
 * 2. Transform all stars to horizontal coordinates
 * 3. Filter visible stars
 * 4. Render based on mode (atlas vs focus)
 */
export function calculateView() {
    if (skyState.rawStars.length === 0) {
        debugLog("No star data loaded", "warn");
        return;
    }
    
    const date = getCurrentTime();
    const sliderMag = getCurrentMagnitudeLimit();
    
    // In focus mode, force magnitude limit to max
    const effectiveMagLimit = skyState.isInFocusMode() 
        ? FOCUS_MODE_MAGNITUDE 
        : sliderMag;
    
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
        const inFocus = skyState.isInFocusMode() && 
                        star.constId === skyState.focusConstId;
        
        // Atlas mode: only above-horizon stars
        if (!skyState.isInFocusMode() && inView) {
            skyState.starsById.set(rawStar.id, star);
            if (star.mag <= effectiveMagLimit) {
                skyState.visibleStars.push(star);
            }
        }
        // Focus mode: all stars in constellation (for geometry)
        else if (inFocus) {
            skyState.starsById.set(rawStar.id, star);
            if (star.mag <= effectiveMagLimit) {
                skyState.visibleStars.push(star);
            }
        }
    }
    
    // Sort by magnitude (brightest first)
    skyState.visibleStars.sort((a, b) => a.mag - b.mag);
    
    // Render
    if (skyState.isInFocusMode()) {
        renderFocusMode(skyState.visibleStars, date);
    } else {
        renderAtlasMode(skyState.visibleStars, date);
    }
    
    // Update table
    renderStarTable(
        skyState.visibleStars,
        (star) => {
            const vb = document.getElementById('skyCanvas').viewBox.baseVal;
            const scaleFactor = vb.width / 1000;
            const starEl = document.getElementById(`star-${star.id}`);
            if (starEl) {
                starEl.dispatchEvent(new Event('mouseover'));
            }
        },
        () => {
            if (!skyState.isInFocusMode()) {
                resetFocus();
            }
        }
    );
    
    debugLog(`Rendered ${skyState.visibleStars.length} stars`, "info");
}

/**
 * Render atlas mode (full sky view).
 */
function renderAtlasMode(stars, date) {
    const svg = document.getElementById('skyCanvas');
    svg.setAttribute('viewBox', '0 0 1000 1000');
    
    // Clear any rotations from focus mode
    const layers = ['starLayer', 'boundaryLayer', 'linesLayer'];
    layers.forEach(layerId => {
        const layer = document.getElementById(layerId);
        layer.style.transform = '';
        layer.style.transformOrigin = '';
    });
    
    // Show/hide layers
    const gridToggle = document.getElementById('gridToggle');
    document.getElementById('gridLayer').style.display = 
        gridToggle.checked ? 'block' : 'none';
    
    document.getElementById('linesLayer').innerHTML = '';
    
    renderStars(stars, 1.0);
    renderBoundaries(date, 1.0);
}

/**
 * Render focus mode (zoomed constellation view).
 */
function renderFocusMode(stars, date) {
    // Calculate center point and extent of constellation
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let pointCount = 0;
    
    // Collect all boundary points for bounding box
    for (const [key, points] of Object.entries(skyState.rawBoundaries)) {
        if (normalizeConstellationId(key) === skyState.focusConstId) {
            points.forEach(([raHours, decDegrees]) => {
                const hor = equatorialToHorizontal(date, raHours, decDegrees);
                if (hor.altitude > -10) {
                    const pt = projectToSVG(hor.altitude, hor.azimuth);
                    minX = Math.min(minX, pt.x);
                    maxX = Math.max(maxX, pt.x);
                    minY = Math.min(minY, pt.y);
                    maxY = Math.max(maxY, pt.y);
                    pointCount++;
                }
            });
        }
    }
    
    // Fallback to stars if no boundary data
    if (pointCount === 0) {
        stars.forEach(s => {
            minX = Math.min(minX, s.x);
            maxX = Math.max(maxX, s.x);
            minY = Math.min(minY, s.y);
            maxY = Math.max(maxY, s.y);
            pointCount++;
        });
    }
    
    if (pointCount === 0) {
        debugLog("No data for constellation focus", "error");
        exitConstellationMode();
        return;
    }
    
    // Calculate true center using bounding box
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    // Calculate size needed to fit constellation
    const width = maxX - minX;
    const height = maxY - minY;
    const maxExtent = Math.max(width, height);
    
    // Add padding and create square viewBox centered on constellation
    const padding = 50;
    const viewSize = maxExtent + (padding * 2);
    
    const vbX = centerX - viewSize / 2;
    const vbY = centerY - viewSize / 2;
    
    const svg = document.getElementById('skyCanvas');
    svg.setAttribute('viewBox', `${vbX} ${vbY} ${viewSize} ${viewSize}`);
    
    // No rotation needed - South-up orientation is the default
    const layers = ['starLayer', 'boundaryLayer', 'linesLayer'];
    layers.forEach(layerId => {
        const layer = document.getElementById(layerId);
        layer.style.transform = '';
        layer.style.transformOrigin = '';
    });
    
    // Hide grid in focus mode
    document.getElementById('gridLayer').style.display = 'none';
    
    const scaleFactor = viewSize / 1000;
    
    renderStars(stars, scaleFactor);
    renderBoundaries(date, scaleFactor);
    renderConstellationLines(skyState.focusConstId, scaleFactor);
    
    // Ensure focus panel is updated
    clearStarFocusPanel();
    updateConstellationFocusPanel(skyState.focusConstId);
}

/**
 * Exit constellation focus mode.
 */
export function exitConstellationMode() {
    skyState.exitFocusMode();
    calculateView();
}

// ============ Event Handlers ============

/**
 * Handle mouse movement over sky canvas.
 */
function handleSkyMove(evt) {
    if (skyState.isInFocusMode()) return;
    
    const point = svgPointFromEvent(evt);
    if (!point || !isInsideHorizon(point)) {
        if (skyState.lastHoverConst) {
            skyState.lastHoverConst = "";
            resetFocus();
        }
        return;
    }
    
    const hitConstId = findConstellationAtPoint(point);
    
    if (hitConstId && hitConstId !== skyState.lastHoverConst) {
        skyState.lastHoverConst = hitConstId;
        highlightConstellation(hitConstId);
    } else if (!hitConstId && skyState.lastHoverConst) {
        skyState.lastHoverConst = "";
        resetFocus();
    }
}

/**
 * Handle click on sky canvas.
 */
function handleSkyClick(evt) {
    if (skyState.isInFocusMode()) return;
    
    if (skyState.lastHoverConst) {
        skyState.enterFocusMode(skyState.lastHoverConst);
        calculateView();
    }
}

/**
 * Handle mouse leaving sky canvas.
 */
function handleSkyLeave() {
    if (!skyState.isInFocusMode()) {
        skyState.lastHoverConst = "";
        resetFocus();
    }
}

/**
 * Toggle grid visibility.
 */
export function toggleGrid() {
    const gridLayer = document.getElementById('gridLayer');
    const gridToggle = document.getElementById('gridToggle');
    gridLayer.style.display = gridToggle.checked ? 'block' : 'none';
}

/**
 * Draw coordinate grid on sky.
 */
function drawGrid() {
    const grid = document.getElementById('gridLayer');
    
    // Horizon circle
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", SVG_CENTER);
    circle.setAttribute("cy", SVG_CENTER);
    circle.setAttribute("r", SVG_RADIUS);
    circle.setAttribute("fill", "rgba(12,20,37,0.4)");
    circle.setAttribute("stroke", "rgba(56,189,248,0.2)");
    grid.appendChild(circle);
    
    // Cardinal directions with South-up projection
    // Azimuth 0° (North) points down, 180° (South) points up
    const directions = [
        { azimuth: 0, label: 'N' },    // North
        { azimuth: 90, label: 'E' },   // East
        { azimuth: 180, label: 'S' },  // South
        { azimuth: 270, label: 'W' }   // West
    ];
    
    directions.forEach(dir => {
        // Apply same transformation as projectToSVG: theta = (270 + azimuth)
        const theta = (270 + dir.azimuth) * Math.PI / 180;
        const x = SVG_CENTER + (SVG_RADIUS + 25) * Math.cos(theta);
        const y = SVG_CENTER - (SVG_RADIUS + 25) * Math.sin(theta);
        
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", x);
        text.setAttribute("y", y);
        text.setAttribute("fill", "rgba(56,189,248,0.5)");
        text.setAttribute("font-size", "14");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.textContent = dir.label;
        
        grid.appendChild(text);
    });
}

// ============ Initialization ============

/**
 * Initialize application.
 */
async function init() {
    setLocalTime();
    updateMagnitudeLabel();
    drawGrid();
    
    // Check Astronomy Engine
    if (typeof Astronomy === 'undefined') {
        debugLog("CRITICAL: Astronomy Engine library not loaded", "error");
        toggleConsole(true);
        return;
    }
    
    // Initialize observer
    try {
        skyState.initObserver();
    } catch (error) {
        debugLog(`Failed to initialize observer: ${error.message}`, "error");
        toggleConsole(true);
        return;
    }
    
    // Load data
    try {
        await loadData();
        calculateView();
    } catch (error) {
        // Error already logged in loadData
    }
    
    // Setup event listeners
    const svg = document.getElementById('skyCanvas');
    svg.addEventListener('mousemove', handleSkyMove);
    svg.addEventListener('mouseleave', handleSkyLeave);
    svg.addEventListener('click', handleSkyClick);
    
    const boundaryToggle = document.getElementById('boundaryToggle');
    boundaryToggle.addEventListener('change', () => {
        const layer = document.getElementById('boundaryLayer');
        layer.style.display = boundaryToggle.checked ? 'block' : 'none';
    });
    
    debugLog("Application initialized", "success");
}

// ============ Global Exports ============

window.calculateView = calculateView;
window.exitConstellationMode = exitConstellationMode;
window.handleManualFiles = (input) => handleManualFiles(input.files);
window.toggleGrid = toggleGrid;
window.filterTable = () => renderStarTable(
    skyState.visibleStars,
    (s) => document.getElementById(`star-${s.id}`)?.dispatchEvent(new Event('mouseover')),
    resetFocus
);
window.toggleConsole = toggleConsole;
window.adjustMagnitude = (delta) => {
    const currentVal = parseFloat(document.getElementById('magVal').textContent);
    const newVal = Math.max(1, Math.min(6, currentVal + delta));
    document.getElementById('magVal').textContent = newVal.toFixed(1);
    calculateView();
};
window.adjustTime = (deltaHours) => {
    const timeInput = document.getElementById('timeInput');
    const currentTime = new Date(timeInput.value);
    currentTime.setHours(currentTime.getHours() + deltaHours);
    
    // Update input in datetime-local format
    currentTime.setMinutes(currentTime.getMinutes() - currentTime.getTimezoneOffset());
    timeInput.value = currentTime.toISOString().slice(0, 16);
    
    calculateView();
};

// ============ Start Application ============

window.addEventListener('load', init);