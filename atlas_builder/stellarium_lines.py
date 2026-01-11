"""
Constellation line definitions from Stellarium.

Fetches and parses Stellarium's modern sky culture to extract
constellation stick figures as HIP ID pairs.
"""

import re
from typing import Dict, List, Set, Tuple

import requests

from .config import SIMBAD_TIMEOUT_SECONDS, get_stellarium_lines_url
from .logging_utils import log, log_step


# Constellation ID normalization map
# Maps Stellarium's uppercase codes to canonical mixed-case abbreviations
CONSTELLATION_CANONICAL_IDS = {
    "AND": "And", "ANT": "Ant", "APS": "Aps", "AQL": "Aql", "AQR": "Aqr",
    "ARA": "Ara", "ARI": "Ari", "AUR": "Aur", "BOO": "Boo", "CAE": "Cae",
    "CAM": "Cam", "CAP": "Cap", "CAR": "Car", "CAS": "Cas", "CEN": "Cen",
    "CEP": "Cep", "CET": "Cet", "CHA": "Cha", "CIR": "Cir", "CMA": "CMa",
    "CMI": "CMi", "CNC": "Cnc", "COL": "Col", "COM": "Com", "CRA": "CrA",
    "CRB": "CrB", "CRT": "Crt", "CRU": "Cru", "CRV": "Crv", "CVN": "CVn",
    "CYG": "Cyg", "DEL": "Del", "DOR": "Dor", "DRA": "Dra", "EQU": "Equ",
    "ERI": "Eri", "FOR": "For", "GEM": "Gem", "GRU": "Gru", "HER": "Her",
    "HOR": "Hor", "HYA": "Hya", "HYI": "Hyi", "IND": "Ind", "LAC": "Lac",
    "LEO": "Leo", "LEP": "Lep", "LIB": "Lib", "LMI": "LMi", "LUP": "Lup",
    "LYN": "Lyn", "LYR": "Lyr", "MEN": "Men", "MIC": "Mic", "MON": "Mon",
    "MUS": "Mus", "NOR": "Nor", "OCT": "Oct", "OPH": "Oph", "ORI": "Ori",
    "PAV": "Pav", "PEG": "Peg", "PER": "Per", "PHE": "Phe", "PIC": "Pic",
    "PSA": "PsA", "PSC": "Psc", "PUP": "Pup", "PYX": "Pyx", "RET": "Ret",
    "SCL": "Scl", "SCO": "Sco", "SCT": "Sct", "SER": "Ser", "SEX": "Sex",
    "SGE": "Sge", "SGR": "Sgr", "TAU": "Tau", "TEL": "Tel", "TRA": "TrA",
    "TRI": "Tri", "TUC": "Tuc", "UMA": "UMa", "UMI": "UMi", "VEL": "Vel",
    "VIR": "Vir", "VOL": "Vol", "VUL": "Vul"
}


def fetch_constellation_lines() -> Tuple[Dict[str, List[List[int]]], Set[int]]:
    """
    Download and parse Stellarium's constellation line definitions.
    
    Returns:
        Tuple of:
        - lines_by_constellation: Dict mapping constellation ID to list of line pairs
          Format: {"Ori": [[HIP1, HIP2], [HIP2, HIP3], ...], ...}
        - required_hip_ids: Set of all HIP IDs referenced in lines
        
    Raises:
        requests.HTTPError: If download fails
        RuntimeError: If JSON format is unrecognized
        
    Note:
        Fetches from Stellarium based on STELLARIUM_SKYCULTURE config.
        ID format is "CON <skyculture> XXX" where XXX is the 3-letter code.
        
    Example:
        >>> lines, hips = fetch_constellation_lines()
        >>> lines["Ori"]
        [[25428, 25336], [25336, 25930], ...]
        >>> len(hips)
        847  # Total stars used in all constellation figures
    """
    url = get_stellarium_lines_url()
    log_step("Fetching Constellation Lines", f"Source: {url}")
    
    response = requests.get(url, timeout=SIMBAD_TIMEOUT_SECONDS)
    response.raise_for_status()
    data = response.json()
    
    lines_by_constellation: Dict[str, List[List[int]]] = {}
    required_hip_ids: Set[int] = set()
    
    constellations = data.get("constellations", [])
    if not constellations:
        raise RuntimeError("No constellations found in Stellarium data")
    
    for const in constellations:
        # Format: "id": "CON modern_st Mic" or "CON modern Mic"
        const_id_raw = const.get("id", "")
        
        if not const_id_raw:
            continue
        
        # Extract the 3-letter code from "CON <skyculture> XXX"
        parts = const_id_raw.split()
        if len(parts) < 3:
            continue
        
        raw_abbr = parts[-1]  # Last part is the constellation abbreviation
        
        # Normalize to canonical format
        const_id = CONSTELLATION_CANONICAL_IDS.get(
            raw_abbr.upper(), 
            raw_abbr
        )
        
        # Parse polylines into pair-wise segments
        polylines = const.get("lines") or []
        line_pairs: List[List[int]] = []
        
        for polyline in polylines:
            if not polyline or len(polyline) < 2:
                continue
            
            # Format: simple arrays of integers [[1234, 5678, 9012]]
            try:
                hip_sequence = [int(h) for h in polyline]
            except (ValueError, TypeError):
                continue
            
            if len(hip_sequence) < 2:
                continue
            
            # Convert polyline [A, B, C, D] into pairs [[A,B], [B,C], [C,D]]
            for i in range(len(hip_sequence) - 1):
                hip_a = hip_sequence[i]
                hip_b = hip_sequence[i + 1]
                
                line_pairs.append([hip_a, hip_b])
                required_hip_ids.add(hip_a)
                required_hip_ids.add(hip_b)
        
        if line_pairs:
            lines_by_constellation[const_id] = line_pairs
    
    if not lines_by_constellation:
        raise RuntimeError("No valid constellation lines parsed")
    
    log(f"Parsed {len(lines_by_constellation)} constellations", "success")
    log(f"Total line segments: {sum(len(v) for v in lines_by_constellation.values())}")
    log(f"Unique stars in lines: {len(required_hip_ids)}")
    
    return lines_by_constellation, required_hip_ids