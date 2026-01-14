/**
 * UI management module.
 * 
 * Handles all DOM updates, panels, status messages, and user interactions
 * that don't involve astronomy calculations or rendering.
 */

import { getConstellationDisplayName } from './constants.js';

// ============ Status Messages ============

/**
 * Update application status indicator.
 * 
 * @param {'loading'|'connected'|'error'} type - Status type
 * @param {string} message - Status message text
 */
export function updateStatus(type, message) {
    const statusEl = document.getElementById('status');
    const dot = statusEl.querySelector('.status-dot');
    const text = statusEl.querySelector('span:last-child');

    dot.className = `status-dot status-${type}`;
    text.textContent = message;
}

/**
 * Show manual file upload interface.
 */
export function showManualLoadPrompt() {
    document.getElementById('manualLoad').style.display = 'block';
}

/**
 * Hide manual file upload interface.
 */
export function hideManualLoadPrompt() {
    document.getElementById('manualLoad').style.display = 'none';
}

// ============ Focus Panels ============

/**
 * Update star focus panel with selected star data.
 * 
 * @param {Object} star - Star object with name, magnitude, altitude, etc.
 */
export function updateStarFocusPanel(star) {
    const panel = document.getElementById('starFocus');
    panel.classList.add('focus-active-star');

    document.getElementById('sf-name').textContent = star.name;
    document.getElementById('sf-sec').textContent = star.bayer || "";
    document.getElementById('sf-mag').textContent = star.mag.toFixed(2);
    document.getElementById('sf-pos').textContent =
        `${star.alt.toFixed(1)}° / ${star.az.toFixed(1)}°`;
}

/**
 * Update constellation focus panel.
 * 
 * @param {string} constId - Constellation abbreviation
 */
export function updateConstellationFocusPanel(constId) {
    const panel = document.getElementById('constFocus');
    panel.classList.add('focus-active-const');

    document.getElementById('cf-name').textContent = getConstellationDisplayName(constId);
    document.getElementById('cf-abbr').textContent = constId;
}

/**
 * Clear star focus panel (reset to default state).
 */
export function clearStarFocusPanel() {
    const panel = document.getElementById('starFocus');
    panel.classList.remove('focus-active-star');

    document.getElementById('sf-name').textContent = "—";
    document.getElementById('sf-sec').textContent = "";
    document.getElementById('sf-mag').textContent = "—";
    document.getElementById('sf-pos').textContent = "—";
}

/**
 * Clear constellation focus panel.
 */
export function clearConstellationFocusPanel() {
    const panel = document.getElementById('constFocus');
    panel.classList.remove('focus-active-const');

    document.getElementById('cf-name').textContent = "—";
    document.getElementById('cf-abbr').textContent = "—";
}

// ============ Time and Magnitude Controls ============

/**
 * Set time input to 10 PM on current day in local time.
 */
export function setLocalTime() {
    const now = new Date();
    // Set to 10 PM (22:00) today
    now.setHours(22, 0, 0, 0);

    // Convert to local datetime-local format
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('timeInput').value = now.toISOString().slice(0, 16);
}

/**
 * Update magnitude slider label.
 */
export function updateMagnitudeLabel() {
    // No-op - magnitude is displayed directly
}

/**
 * Get current time from time input.
 * 
 * @returns {Date} Selected date/time
 */
export function getCurrentTime() {
    return new Date(document.getElementById('timeInput').value);
}

/**
 * Get current magnitude limit from slider.
 * 
 * @returns {number} Maximum magnitude
 */
export function getCurrentMagnitudeLimit() {
    return parseFloat(document.getElementById('magVal').textContent);
}

// ============ Debug Console ============

/**
 * Log message to debug console.
 * 
 * @param {string} message - Log message
 * @param {'info'|'error'|'warn'|'success'} type - Log type
 */
export function debugLog(message, type = 'info') {
    const console = document.getElementById('debugConsole');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;

    const time = new Date().toLocaleTimeString().split(' ')[0];
    entry.textContent = `[${time}] ${message}`;

    console.appendChild(entry);
    console.scrollTop = console.scrollHeight;
}

/**
 * Toggle debug console visibility.
 * 
 * @param {boolean} forceOpen - Force console open if true
 */
export function toggleConsole(forceOpen = false) {
    const el = document.getElementById('debugConsole');
    if (forceOpen) {
        el.style.display = 'block';
    } else {
        el.style.display = (el.style.display === 'none' || el.style.display === '')
            ? 'block'
            : 'none';
    }
}