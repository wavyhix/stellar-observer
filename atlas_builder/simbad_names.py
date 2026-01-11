"""
Star name resolution via SIMBAD with local caching.

Resolves Hipparcos catalog numbers to:
1. Proper names (e.g., "Betelgeuse")
2. Bayer designations (e.g., "Alpha Orionis")

Uses aggressive caching to avoid repeated network queries.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Set

from astroquery.simbad import Simbad

from .config import SIMBAD_CHUNK_SIZE
from .logging_utils import log, log_step


# Greek letter abbreviations used by SIMBAD
SIMBAD_GREEK_LETTERS = {
    "alf": "Alpha", "bet": "Beta", "gam": "Gamma", "del": "Delta",
    "eps": "Epsilon", "zet": "Zeta", "eta": "Eta", "tet": "Theta",
    "iot": "Iota", "kap": "Kappa", "lam": "Lambda", "mu": "Mu",
    "nu": "Nu", "ksi": "Xi", "omi": "Omicron", "o": "Omicron",
    "pi": "Pi", "rho": "Rho", "sig": "Sigma", "tau": "Tau",
    "ups": "Upsilon", "phi": "Phi", "khi": "Chi", "chi": "Chi",
    "psi": "Psi", "ome": "Omega",
}

# Constellation genitive forms for Bayer names
CONSTELLATION_GENITIVES = {
    "And": "Andromedae", "Ant": "Antliae", "Aps": "Apodis",
    "Aql": "Aquilae", "Aqr": "Aquarii", "Ara": "Arae", "Ari": "Arietis",
    "Aur": "Aurigae", "Boo": "Boötis", "Cae": "Caeli",
    "Cam": "Camelopardalis", "Cap": "Capricorni", "Car": "Carinae",
    "Cas": "Cassiopeiae", "Cen": "Centauri", "Cep": "Cephei",
    "Cet": "Ceti", "Cha": "Chamaeleontis", "Cir": "Circini",
    "CMa": "Canis Majoris", "CMi": "Canis Minoris", "Cnc": "Cancri",
    "Col": "Columbae", "Com": "Comae Berenices", "CrA": "Coronae Australis",
    "CrB": "Coronae Borealis", "Crt": "Crateris", "Cru": "Crucis",
    "Crv": "Corvi", "CVn": "Canum Venaticorum", "Cyg": "Cygni",
    "Del": "Delphini", "Dor": "Doradus", "Dra": "Draconis",
    "Equ": "Equulei", "Eri": "Eridani", "For": "Fornacis",
    "Gem": "Geminorum", "Gru": "Gruis", "Her": "Herculis",
    "Hor": "Horologii", "Hya": "Hydrae", "Hyi": "Hydri", "Ind": "Indi",
    "Lac": "Lacertae", "Leo": "Leonis", "Lep": "Leporis", "Lib": "Librae",
    "LMi": "Leonis Minoris", "Lup": "Lupi", "Lyn": "Lyncis",
    "Lyr": "Lyrae", "Men": "Mensae", "Mic": "Microscopii",
    "Mon": "Monocerotis", "Mus": "Muscae", "Nor": "Normae",
    "Oct": "Octantis", "Oph": "Ophiuchi", "Ori": "Orionis",
    "Pav": "Pavonis", "Peg": "Pegasi", "Per": "Persei",
    "Phe": "Phoenicis", "Pic": "Pictoris", "PsA": "Piscis Austrini",
    "Psc": "Piscium", "Pup": "Puppis", "Pyx": "Pyxidis",
    "Ret": "Reticuli", "Scl": "Sculptoris", "Sco": "Scorpii",
    "Sct": "Scuti", "Ser": "Serpentis", "Sex": "Sextantis",
    "Sge": "Sagittae", "Sgr": "Sagittarii", "Tau": "Tauri",
    "Tel": "Telescopii", "TrA": "Trianguli Australis", "Tri": "Trianguli",
    "Tuc": "Tucanae", "UMa": "Ursae Majoris", "UMi": "Ursae Minoris",
    "Vel": "Velorum", "Vir": "Virginis", "Vol": "Volans",
    "Vul": "Vulpeculae",
}


class StarNameCache:
    """
    Local JSON cache for star name resolution results.
    
    Prevents redundant SIMBAD queries across builds. Cache format:
    {
        "12345": {"p": "Betelgeuse", "b": "Alpha Orionis"},
        "67890": {"p": null, "b": "Beta Tauri"}
    }
    
    Keys:
        p = proper name (IAU or common)
        b = Bayer designation
    """
    
    def __init__(self, cache_path: Path):
        """
        Initialize cache from disk.
        
        Args:
            cache_path: Path to JSON cache file
        """
        self.cache_path = cache_path
        self.data: Dict[int, Dict[str, Optional[str]]] = {}
        
        if cache_path.exists():
            try:
                with open(cache_path, 'r', encoding='utf-8') as f:
                    raw = json.load(f)
                    # Convert string keys back to integers
                    self.data = {int(k): v for k, v in raw.items()}
                log(f"Loaded {len(self.data)} cached star names", "success")
            except Exception as e:
                log(f"Cache load failed: {e}", "warn")
    
    def save(self) -> None:
        """Write cache to disk."""
        with open(self.cache_path, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, indent=2)
    
    def get(self, hip_id: int) -> Optional[Dict[str, Optional[str]]]:
        """Retrieve cached entry."""
        return self.data.get(hip_id)
    
    def update(self, new_data: Dict[int, Dict[str, Optional[str]]]) -> None:
        """Merge new results into cache."""
        self.data.update(new_data)


def _normalize_greek_token(token: str) -> str:
    """Remove non-alphabetic characters and lowercase."""
    return re.sub(r"[^A-Za-z]", "", token).lower()


def _parse_simbad_ids(ids_field) -> List[str]:
    """
    Parse SIMBAD's pipe-separated identifier field.
    
    Args:
        ids_field: Raw IDS column value (bytes or str)
        
    Returns:
        List of cleaned identifier strings
    """
    if isinstance(ids_field, (bytes, bytearray)):
        s = ids_field.decode("utf-8")
    else:
        s = str(ids_field)
    
    return [x.strip() for x in s.split("|") if x.strip()]


def _extract_hip_from_ids(ids: List[str]) -> Optional[int]:
    """
    Find HIP identifier in SIMBAD identifier list.
    
    Args:
        ids: List of identifier strings
        
    Returns:
        Hipparcos catalog number or None
        
    Example:
        >>> _extract_hip_from_ids(["HD 39801", "HIP 27989", "HR 2061"])
        27989
    """
    for ident in ids:
        if ident.upper().startswith("HIP "):
            try:
                return int(ident.split()[1])
            except (IndexError, ValueError):
                continue
    return None


def _parse_bayer_designation(ids: List[str]) -> Optional[str]:
    """
    Extract and format Bayer designation from SIMBAD identifiers.
    
    Handles patterns like:
    - "alf Ori" -> "Alpha Orionis"
    - "1 tau Eri" -> "Tau1 Eridani"
    - "pi 3 Ori" -> "Pi3 Orionis"
    
    Args:
        ids: List of SIMBAD identifiers
        
    Returns:
        Formatted Bayer name or None
    """
    # Regex to match: (optional number) (greek letter) (optional number)
    greek_pattern = re.compile(r"(?:^|\s)(\d+)?\s*([a-zA-Z]{3})\s*(\d+)?(?:$|\s)")
    
    for raw_id in ids:
        # Strip common prefixes
        clean_id = raw_id.replace("* ", "").replace("V* ", "").strip()
        parts = clean_id.split()
        
        if len(parts) < 2:
            continue
        
        # Last part should be constellation abbreviation
        const_abbr = parts[-1]
        genitive = CONSTELLATION_GENITIVES.get(const_abbr)
        
        if not genitive:
            continue
        
        # Join prefix parts (e.g., "1 tau" or "pi 3")
        prefix = " ".join(parts[:-1])
        
        match = greek_pattern.search(prefix)
        if not match:
            continue
        
        num_prefix, greek_token, num_suffix = match.groups()
        greek_name = SIMBAD_GREEK_LETTERS.get(_normalize_greek_token(greek_token))
        
        if not greek_name:
            continue
        
        # Construct: "Alpha1 Centauri" format
        number = num_prefix or num_suffix or ""
        return f"{greek_name}{number} {genitive}"
    
    return None


def fetch_star_names(
    hip_ids: Set[int],
    cache_path: Path
) -> Dict[int, Dict[str, Optional[str]]]:
    """
    Resolve star names for a set of Hipparcos IDs using SIMBAD.
    
    Uses local cache to minimize network queries. Queries SIMBAD
    in chunks to respect rate limits.
    
    Args:
        hip_ids: Set of Hipparcos catalog numbers
        cache_path: Path to JSON cache file
        
    Returns:
        Dict mapping HIP ID to name data:
        {12345: {"p": "Rigel", "b": "Beta Orionis"}}
        
    Note:
        Prefers IAU proper names over common names.
        Bayer names are constructed from genitive constellation forms.
    """
    log_step("Resolving Star Names")
    
    cache = StarNameCache(cache_path)
    
    # Identify stars not in cache
    to_fetch = [h for h in hip_ids if cache.get(h) is None]
    
    if not to_fetch:
        log("All names found in cache", "success")
        return cache.data
    
    log(f"Querying SIMBAD for {len(to_fetch)} stars")
    log(f"(Processing in chunks of {SIMBAD_CHUNK_SIZE})")
    
    # Configure SIMBAD to return identifier lists
    Simbad.reset_votable_fields()
    Simbad.add_votable_fields("ids")
    
    new_data: Dict[int, Dict[str, Optional[str]]] = {}
    
    for i in range(0, len(to_fetch), SIMBAD_CHUNK_SIZE):
        chunk = to_fetch[i:i + SIMBAD_CHUNK_SIZE]
        query_list = [f"HIP {h}" for h in chunk]
        
        try:
            table = Simbad.query_objects(query_list)
            
            if not table:
                log(f"Chunk {i//SIMBAD_CHUNK_SIZE + 1}: No results", "warn")
                continue
            
            # Find IDS column (case-insensitive)
            cols = {c.upper(): c for c in table.colnames}
            id_col = cols.get("IDS")
            
            if not id_col:
                log("IDS column not found in SIMBAD response", "warn")
                continue
            
            for row in table:
                ids_list = _parse_simbad_ids(row[id_col])
                hip = _extract_hip_from_ids(ids_list)
                
                if not hip:
                    continue
                
                proper_name: Optional[str] = None
                bayer_name: Optional[str] = None
                
                # Priority 1: Proper names
                for raw_id in ids_list:
                    clean = raw_id.replace("* ", "").replace("V* ", "").strip()
                    
                    if clean.upper().startswith("NAME-IAU "):
                        proper_name = clean[9:].strip()
                        break
                    elif clean.upper().startswith("NAME ") and proper_name is None:
                        proper_name = clean[5:].strip()
                
                # Priority 2: Bayer designation
                if not bayer_name:
                    bayer_name = _parse_bayer_designation(ids_list)
                
                new_data[hip] = {"p": proper_name, "b": bayer_name}
        
        except Exception as e:
            log(f"Chunk {i//SIMBAD_CHUNK_SIZE + 1} error: {e}", "error")
    
    if new_data:
        cache.update(new_data)
        cache.save()
        log(f"Retrieved {len(new_data)} new names", "success")
    
    return cache.data