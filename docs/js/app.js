/**
 * Application bootstrap and main controller.
 * 
 * Responsibilities:
 * - Load JSON data files
 * - Initialize UI and event handlers
 * - Camera/zoom interaction handling
 * - Coordinate view calculations and rendering
 * - Sky interaction (constellation highlighting)
 */

import {
    SVG_CENTER,
    SVG_RADIUS,
} from './constants.js';

import {
    updateStatus,
    showManualLoadPrompt,
    hideManualLoadPrompt,
    setLocalTime,
    updateMagnitudeLabel,
    debugLog,
    toggleConsole,
} from './ui.js';

import {
    skyState,
    calculateView,
    findConstellationAtPoint,
} from './sky_engine.js';

import {
    renderView,
    renderStarTable,
    highlightConstellation,
    clearConstellationHighlight,
} from './rendering.js';

// ============ Data Loading ============

/**
 * Load all JSON data files.
 * 
 * @returns {Promise<void>}
 */
async function loadData() {
    try {
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

                if (skyState.rawStars.length && Object.keys(skyState.rawBoundaries).length) {
                    hideManualLoadPrompt();
                    updateStatus('connected', 'Manual load successful');
                    calculateAndRender();
                }
            } catch (err) {
                debugLog(`Parse error: ${err.message}`, "error");
            }
        };
        reader.readAsText(file);
    });
}

// ============ View Orchestration ============

/**
 * Calculate and render the sky view.
 */
function calculateAndRender() {
    calculateView();
    renderView();
}

// ============ Camera / Zoom / Pan Handling ============

let isDragging = false;
let startDrag = { x: 0, y: 0 };
let startPan = { x: 0, y: 0 };

/**
 * Helper to transform mouse event to SVG coordinates.
 */
function getSVGPoint(evt) {
    const svg = document.getElementById('skyCanvas');
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
}

/**
 * Helper to transform mouse event to world coordinates (accounting for camera transform).
 */
function getWorldPoint(evt) {
    const svgPt = getSVGPoint(evt);
    const t = skyState.transform;
    
    // Inverse transform: (svg - translate) / scale
    const worldX = (svgPt.x - t.x) / t.k;
    const worldY = (svgPt.y - t.y) / t.k;
    
    return { x: worldX, y: worldY };
}

/**
 * Apply circular bounds to keep viewport inside atlas circle.
 */
function applyCircularBounds(newX, newY, newK) {
    const ATLAS_CENTER = 500;
    const ATLAS_RADIUS = 450;

    let effectiveRadius = ATLAS_RADIUS * (1 - 1 / newK);
    if (effectiveRadius < 0) effectiveRadius = 0;

    const vcx = (500 - newX) / newK;
    const vcy = (500 - newY) / newK;

    const dx = vcx - ATLAS_CENTER;
    const dy = vcy - ATLAS_CENTER;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > effectiveRadius) {
        let clampedX, clampedY;
        if (effectiveRadius <= 0 || dist === 0) {
            clampedX = ATLAS_CENTER;
            clampedY = ATLAS_CENTER;
        } else {
            const ratio = effectiveRadius / dist;
            clampedX = ATLAS_CENTER + dx * ratio;
            clampedY = ATLAS_CENTER + dy * ratio;
        }

        newX = 500 - clampedX * newK;
        newY = 500 - clampedY * newK;
    }

    return { x: newX, y: newY };
}

function handleWheel(evt) {
    evt.preventDefault();

    const zoomIntensity = 0.001;
    const delta = -evt.deltaY;
    const scaleFactor = Math.exp(delta * zoomIntensity);

    const current = skyState.transform;
    const p = getSVGPoint(evt);
    const sx = p.x;
    const sy = p.y;

    const wx = (sx - current.x) / current.k;
    const wy = (sy - current.y) / current.k;

    let newK = current.k * scaleFactor;
    if (newK < 1.0) newK = 1.0;
    if (newK > 5.0) newK = 5.0;

    let newX = sx - wx * newK;
    let newY = sy - wy * newK;

    const bounded = applyCircularBounds(newX, newY, newK);
    skyState.setTransform(bounded.x, bounded.y, newK);
}

function handleMouseDown(evt) {
    if (skyState.transform.k <= 1.01) return;

    isDragging = true;

    const p = getSVGPoint(evt);
    startDrag = { x: p.x, y: p.y };
    startPan = { x: skyState.transform.x, y: skyState.transform.y };

    document.getElementById('mapSection').style.cursor = 'grabbing';
}

function handleMouseMove(evt) {
    if (!isDragging) return;

    evt.preventDefault();

    const p = getSVGPoint(evt);
    const dx = p.x - startDrag.x;
    const dy = p.y - startDrag.y;

    let newX = startPan.x + dx;
    let newY = startPan.y + dy;

    const k = skyState.transform.k;
    const bounded = applyCircularBounds(newX, newY, k);
    skyState.setTransform(bounded.x, bounded.y, k);
}

function handleMouseUp() {
    isDragging = false;
    document.getElementById('mapSection').style.cursor = 'grab';
}

// ============ Sky Interaction ============

/**
 * Handle mouse movement over sky - detect constellation boundaries.
 */
function handleSkyMouseMove(evt) {
    // Don't interfere with dragging
    if (isDragging) return;
    
    // Get world coordinates (compensate for pan/zoom)
    const worldPt = getWorldPoint(evt);
    
    // Test if point is inside any constellation boundary
    const constId = findConstellationAtPoint(worldPt.x, worldPt.y);
    
    if (constId) {
        highlightConstellation(constId);
    } else {
        clearConstellationHighlight();
    }
}

// ============ Grid Management ============

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

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", SVG_CENTER);
    circle.setAttribute("cy", SVG_CENTER);
    circle.setAttribute("r", SVG_RADIUS);
    circle.setAttribute("fill", "rgba(12,20,37,0.4)");
    circle.setAttribute("stroke", "rgba(56,189,248,0.2)");
    grid.appendChild(circle);

    const directions = [
        { azimuth: 0, label: 'N' },
        { azimuth: 90, label: 'E' },
        { azimuth: 180, label: 'S' },
        { azimuth: 270, label: 'W' }
    ];

    directions.forEach(dir => {
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

    if (typeof Astronomy === 'undefined') {
        debugLog("CRITICAL: Astronomy Engine library not loaded", "error");
        toggleConsole(true);
        return;
    }

    try {
        skyState.initObserver();
    } catch (error) {
        debugLog(`Failed to initialize observer: ${error.message}`, "error");
        toggleConsole(true);
        return;
    }

    try {
        await loadData();
        calculateAndRender();
    } catch (error) {
        // handled
    }

    const section = document.getElementById('mapSection');
    section.addEventListener('wheel', handleWheel, { passive: false });
    section.addEventListener('mousedown', handleMouseDown);
    section.addEventListener('mousemove', handleSkyMouseMove);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    const boundaryToggle = document.getElementById('boundaryToggle');
    boundaryToggle.addEventListener('change', () => {
        const layer = document.getElementById('boundaryLayer');
        layer.style.display = boundaryToggle.checked ? 'block' : 'none';
    });

    debugLog("Application initialized", "success");
}

// ============ Global Exports ============

window.calculateView = calculateAndRender;
window.exitConstellationMode = () => { /* No-op */ };
window.handleManualFiles = (input) => handleManualFiles(input.files);
window.toggleGrid = toggleGrid;
window.filterTable = renderStarTable;
window.toggleConsole = toggleConsole;
window.adjustMagnitude = (delta) => {
    const valEl = document.getElementById('magVal');
    const currentVal = parseFloat(valEl.textContent);
    const newVal = Math.max(1, Math.min(5, currentVal + delta));
    valEl.textContent = newVal.toFixed(1);

    if (window.magTimeout) clearTimeout(window.magTimeout);
    window.magTimeout = setTimeout(() => calculateAndRender(), 50);
};
window.adjustTime = (deltaHours) => {
    const timeInput = document.getElementById('timeInput');
    const currentTime = new Date(timeInput.value);
    currentTime.setHours(currentTime.getHours() + deltaHours);
    currentTime.setMinutes(currentTime.getMinutes() - currentTime.getTimezoneOffset());
    timeInput.value = currentTime.toISOString().slice(0, 16);
    calculateAndRender();
};

window.addEventListener('load', init);