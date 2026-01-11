/**
 * Frontend configuration constants.
 * 
 * Centralizes all magic numbers, mappings, and observer location
 * to prevent scattered configuration across modules.
 */

// ============ SVG Geometry ============
export const SVG_RADIUS = 450;
export const SVG_CENTER = 500;

// ============ Observer Location ============
// Default: Auckland, New Zealand
export const OBSERVER_LATITUDE = -36.8485;
export const OBSERVER_LONGITUDE = 174.7633;
export const OBSERVER_ELEVATION = 0; // meters above sea level

// ============ Rendering Thresholds ============
export const MIN_ALTITUDE_DEGREES = 3.0;
export const DEFAULT_MAX_MAGNITUDE = 5.0;
export const FOCUS_MODE_MAGNITUDE = 6.0; // Show all stars in focus mode

// ============ Interaction ============
export const LINE_WRAP_THRESHOLD = 400; // Max pixel distance before line is artifact
export const BOUNDARY_GAP_THRESHOLD = 300; // Pixel threshold for boundary segments

// ============ Constellation Full Names ============
export const CONSTELLATION_FULL_NAMES = {
    And: "Andromeda", Ant: "Antlia", Aps: "Apus", Aql: "Aquila", Aqr: "Aquarius",
    Ara: "Ara", Ari: "Aries", Aur: "Auriga", Boo: "Boötes", Cae: "Caelum",
    Cam: "Camelopardalis", Cap: "Capricornus", Car: "Carina", Cas: "Cassiopeia",
    Cen: "Centaurus", Cep: "Cepheus", Cet: "Cetus", Cha: "Chamaeleon", Cir: "Circinus",
    CMa: "Canis Major", CMi: "Canis Minor", Cnc: "Cancer", Col: "Columba",
    Com: "Coma Berenices", CrA: "Corona Australis", CrB: "Corona Borealis",
    Crt: "Crater", Cru: "Crux", Crv: "Corvus", CVn: "Canes Venatici",
    Cyg: "Cygnus", Del: "Delphinus", Dor: "Dorado", Dra: "Draco", Equ: "Equuleus",
    Eri: "Eridanus", For: "Fornax", Gem: "Gemini", Gru: "Grus", Her: "Hercules",
    Hor: "Horologium", Hya: "Hydra", Hyi: "Hydrus", Ind: "Indus", Lac: "Lacerta",
    Leo: "Leo", Lep: "Lepus", Lib: "Libra", LMi: "Leo Minor", Lup: "Lupus",
    Lyn: "Lynx", Lyr: "Lyra", Men: "Mensa", Mic: "Microscopium", Mon: "Monoceros",
    Mus: "Musca", Nor: "Norma", Oct: "Octans", Oph: "Ophiuchus", Ori: "Orion",
    Pav: "Pavo", Peg: "Pegasus", Per: "Perseus", Phe: "Phoenix", Pic: "Pictor",
    PsA: "Piscis Austrinus", Psc: "Pisces", Pup: "Puppis", Pyx: "Pyxis",
    Ret: "Reticulum", Scl: "Sculptor", Sco: "Scorpius", Sct: "Scutum",
    Ser: "Serpens", Sex: "Sextans", Sge: "Sagitta", Sgr: "Sagittarius",
    Tau: "Taurus", Tel: "Telescopium", TrA: "Triangulum Australe", Tri: "Triangulum",
    Tuc: "Tucana", UMa: "Ursa Major", UMi: "Ursa Minor", Vel: "Vela", Vir: "Virgo",
    Vol: "Volans", Vul: "Vulpecula"
};

/**
 * Normalize constellation ID to canonical format.
 * 
 * Handles edge cases like:
 * - "CON modern_st Ori" -> "Ori"
 * - "Ser1", "Ser2" -> "Ser"
 * - "PSA" -> "PsA"
 * 
 * @param {string} rawId - Raw constellation identifier
 * @returns {string} Normalized constellation abbreviation
 */
export function normalizeConstellationId(rawId) {
    if (!rawId) return "";
    
    let id = String(rawId).trim();
    if (!id) return "";
    
    // Handle "CON modern_st Ori" format
    if (id.includes(" ")) {
        id = id.split(/\s+/).pop();
    }
    
    // Handle Serpens variants
    if (id.match(/^Ser[12]?$/i)) return "Ser";
    if (id.match(/^serpens\s*(caput|cauda)$/i)) return "Ser";
    
    // Special case: PSA -> PsA
    const upper = id.toUpperCase();
    if (upper === "PSA") return "PsA";
    
    // Match against known constellation IDs
    for (const key of Object.keys(CONSTELLATION_FULL_NAMES)) {
        if (key.toUpperCase() === upper) return key;
    }
    
    // Handle numeric suffixes (e.g., "Ori1" -> "Ori")
    const match = id.match(/^([A-Za-z]+)(\d+)$/);
    if (match) {
        const base = match[1];
        return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
    }
    
    // Default: capitalize first letter
    return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase();
}

/**
 * Get full constellation name from abbreviation.
 * 
 * @param {string} constId - Constellation abbreviation (e.g., "Ori")
 * @returns {string} Full name (e.g., "Orion") or abbreviation if not found
 */
export function getConstellationDisplayName(constId) {
    const normalized = normalizeConstellationId(constId);
    return CONSTELLATION_FULL_NAMES[normalized] || normalized || "—";
}