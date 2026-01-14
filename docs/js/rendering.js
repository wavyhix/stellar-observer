/**
 * Rendering module - all SVG and DOM manipulation.
 * 
 * Responsibilities:
 * - Render stars, boundaries, constellation lines
 * - Star highlighting and focus management
 * - Constellation boundary highlighting
 * - Star table rendering
 * - All SVG element creation and updates
 */

import {
    LINE_WRAP_THRESHOLD,
    BOUNDARY_GAP_THRESHOLD,
    normalizeConstellationId,
    getConstellationDisplayName,
} from './constants.js';

import {
    updateStarFocusPanel,
    updateConstellationFocusPanel,
    clearStarFocusPanel,
    clearConstellationFocusPanel,
    getCurrentTime,
} from './ui.js';

import {
    skyState,
    projectToSVG,
    equatorialToHorizontal,
    findConstellationAtPoint,
} from './sky_engine.js';

// ============ Main Render Function ============

/**
 * Render the complete sky view.
 */
export function renderView() {
    const date = getCurrentTime();

    // 1. Render Stars
    renderStars(skyState.visibleStars);

    // 2. Render Boundaries
    renderBoundaries(date);

    // 3. Render Constellation Lines
    renderConstellationLines();

    // 4. Update grid layer visibility
    const gridToggle = document.getElementById('gridToggle');
    document.getElementById('gridLayer').style.display =
        gridToggle.checked ? 'block' : 'none';

    // 5. Update star table
    renderStarTable();
}

// ============ Star Rendering ============

/**
 * Render stars to SVG layer.
 * 
 * @param {Array} stars - Array of star objects with x, y, mag, id, etc.
 */
function renderStars(stars) {
    const layer = document.getElementById('starLayer');
    layer.innerHTML = '';

    document.getElementById('cameraGroup').style.setProperty('--zoom-growth', '1');

    const frag = document.createDocumentFragment();

    stars.forEach(s => {
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "line");
        dot.setAttribute("x1", s.x);
        dot.setAttribute("y1", s.y);
        dot.setAttribute("x2", s.x);
        dot.setAttribute("y2", s.y);

        let baseRadius = Math.max(1.5, 6 - s.mag);
        const baseDiameter = baseRadius * 2;

        const color = s.proper ? "#ffffff" : "var(--star-gold)";
        const opacity = Math.max(0.6, 1 - (s.mag / 7));

        dot.dataset.baseColor = color;
        dot.dataset.baseDiameter = baseDiameter;
        dot.dataset.baseOpacity = opacity;

        dot.setAttribute("stroke-linecap", "round");
        dot.setAttribute("vector-effect", "non-scaling-stroke");
        dot.style.strokeWidth = `calc(${baseDiameter}px * var(--zoom-growth))`;
        dot.setAttribute("stroke", color);
        dot.style.opacity = opacity;

        dot.classList.add("star-point");
        dot.id = `star-${s.id}`;

        dot.style.cursor = "pointer";
        dot.style.pointerEvents = "all";

        dot.onmouseover = () => { highlightStar(s); };
        dot.onmouseout = () => { resetFocus(); };

        frag.appendChild(dot);
    });

    layer.appendChild(frag);
}

/**
 * Highlight a star on hover.
 */
function highlightStar(star) {
    skyState.lastHighlightedStarId = star.id;

    updateStarFocusPanel(star);

    const el = document.getElementById(`star-${star.id}`);
    if (el) {
        el.setAttribute("stroke", "#38bdf8");
        el.style.opacity = 1.0;

        // Use transform instead of changing stroke-width to prevent layout shift
        el.style.transform = 'scale(1.5)';
        el.style.transformOrigin = `${star.x}px ${star.y}px`;
    }

    if (star.constId) {
        updateConstellationFocusPanel(star.constId);
    }
}

/**
 * Clear highlights and reset star/constellation states.
 */
function resetFocus() {
    clearStarFocusPanel();

    if (skyState.lastHighlightedStarId) {
        const el = document.getElementById(`star-${skyState.lastHighlightedStarId}`);
        if (el) {
            el.classList.remove('star-highlighted');
            el.setAttribute("stroke", el.dataset.baseColor);
            el.style.opacity = el.dataset.baseOpacity;
            el.style.transform = '';
        }
        skyState.lastHighlightedStarId = null;
    }

    clearConstellationHighlight();
}

// ============ Constellation Boundary Rendering ============

/**
 * Render constellation boundaries to SVG.
 * Also builds polygon maps for hit testing.
 * 
 * @param {Date} date - Current observation time
 */
function renderBoundaries(date) {
    const layer = document.getElementById('boundaryLayer');
    layer.innerHTML = '';

    // Clear and rebuild polygon map
    skyState.boundaryPolygons.clear();

    const frag = document.createDocumentFragment();

    for (const [rawKey, points] of Object.entries(skyState.rawBoundaries)) {
        const constId = normalizeConstellationId(rawKey);
        const segments = computeBoundarySegments(points, date);

        // Build merged polygon for hit testing (largest segment only)
        let largestSegment = [];
        for (const segment of segments) {
            if (segment.length > largestSegment.length) {
                largestSegment = segment;
            }
        }
        
        if (largestSegment.length > 0) {
            skyState.boundaryPolygons.set(constId, largestSegment);
        }

        // Render all segments
        segments.forEach(segment => {
            const path = createBoundaryPath(segment, constId);
            frag.appendChild(path);
        });
    }

    layer.appendChild(frag);
}

/**
 * Compute boundary segments with wraparound handling.
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

        if (hor.altitude < -10) {
            lastPt = null;
            continue;
        }

        const pt = projectToSVG(hor.altitude, hor.azimuth);

        let startNew = false;
        if (lastPt) {
            const dist = Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y);
            const isNearZenith = hor.altitude > 80;

            let azJump = 0;
            if (lastAz !== null) {
                azJump = Math.abs(hor.azimuth - lastAz);
                if (azJump > 180) azJump = 360 - azJump;
            }

            if (dist > BOUNDARY_GAP_THRESHOLD || (!isNearZenith && azJump > 90)) {
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
    
    // Critical: Enable pointer events for boundaries
    path.style.pointerEvents = 'visibleStroke';
    path.style.cursor = 'pointer';

    return path;
}

// ============ Constellation Boundary Highlighting ============

/**
 * Highlight constellation boundary.
 * 
 * @param {string} constId - Constellation ID to highlight
 */
export function highlightConstellation(constId) {
    if (skyState.lastHighlightedConstId === constId) return;
    
    // Clear previous highlight
    clearConstellationHighlight();
    
    skyState.lastHighlightedConstId = constId;
    
    // Highlight all boundary paths for this constellation
    const paths = document.querySelectorAll(`.boundary-path[data-const="${constId}"]`);
    paths.forEach(path => {
        path.classList.add('boundary-highlighted');
    });
    
    // Update constellation panel
    updateConstellationFocusPanel(constId);
}

/**
 * Clear constellation boundary highlight.
 */
export function clearConstellationHighlight() {
    if (!skyState.lastHighlightedConstId) return;
    
    const paths = document.querySelectorAll('.boundary-highlighted');
    paths.forEach(path => {
        path.classList.remove('boundary-highlighted');
    });
    
    skyState.lastHighlightedConstId = null;
    clearConstellationFocusPanel();
}

// ============ Constellation Lines Rendering ============

/**
 * Render constellation stick figures.
 */
function renderConstellationLines() {
    const layer = document.getElementById('linesLayer');
    layer.innerHTML = '';

    const frag = document.createDocumentFragment();

    for (const [constId, lines] of Object.entries(skyState.rawLines)) {
        lines.forEach(([hipA, hipB]) => {
            const s1 = skyState.starsById.get(parseInt(hipA));
            const s2 = skyState.starsById.get(parseInt(hipB));

            if (!s1 || !s2) return;

            const dx = s1.x - s2.x;
            const dy = s1.y - s2.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist >= LINE_WRAP_THRESHOLD) return;

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", s1.x);
            line.setAttribute("y1", s1.y);
            line.setAttribute("x2", s2.x);
            line.setAttribute("y2", s2.y);
            line.setAttribute("stroke", "white");
            line.classList.add("const-line");
            line.dataset.const = normalizeConstellationId(constId);

            line.setAttribute("vector-effect", "non-scaling-stroke");
            line.style.strokeWidth = "1.5px";

            frag.appendChild(line);
        });
    }

    layer.appendChild(frag);
    layer.style.opacity = '0';
    layer.style.display = 'none';
}

// ============ Star Table Rendering ============

/**
 * Render star table with filtering support.
 */
export function renderStarTable() {
    const list = document.getElementById('starList');
    const searchVal = document.getElementById('searchInput').value.toLowerCase();

    // Filter stars based on search
    const filteredStars = skyState.visibleStars.filter(s => {
        if (!searchVal) return true;

        const constName = getConstellationDisplayName(s.constId);
        const searchableText =
            `${s.name} ${s.bayer || ""} ${constName} ${s.constId}`.toLowerCase();

        return searchableText.includes(searchVal);
    });

    // Update counter
    list.innerHTML = '';
    document.getElementById('starCount').textContent = `${filteredStars.length}`;

    // Render all filtered stars
    for (let i = 0; i < filteredStars.length; i++) {
        const s = filteredStars[i];
        const constName = getConstellationDisplayName(s.constId);

        const tr = document.createElement('tr');
        tr.id = `row-${s.id}`;
        tr.className = "compact-tr cursor-pointer group";

        // Format display name
        let displayName = s.name;
        if (s.bayer && s.proper) {
            displayName += ` <span class="text-slate-500 text-[9px]">(${s.bayer})</span>`;
        }

        tr.innerHTML = `
            <td class="px-4 py-1.5 font-bold text-slate-200 group-hover:text-sky-400">
                ${displayName}
            </td>
            <td class="px-4 py-1.5 text-amber-500">${s.mag.toFixed(1)}</td>
            <td class="px-4 py-1.5 text-slate-500">
                ${s.alt.toFixed(0)}° / ${s.az.toFixed(0)}°
            </td>
            <td class="px-4 py-1.5 text-pink-500/80 font-bold">${constName}</td>
        `;

        tr.onmouseenter = () => highlightStar(s);
        tr.onmouseleave = () => resetFocus();

        list.appendChild(tr);
    }
}