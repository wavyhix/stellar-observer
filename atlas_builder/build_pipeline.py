"""
Main atlas builder orchestration pipeline.

Coordinates all data generation steps and outputs final JSON files
for the web frontend.
"""

import json
from pathlib import Path
from typing import Dict, List, Optional

from skyfield.api import Star, load_constellation_map, Loader

from .boundaries import generate_boundaries_j2000
from .config import (
    BOUNDARIES_FILENAME,
    LINES_FILENAME,
    MAX_MAGNITUDE,
    NAMES_CACHE_FILENAME,
    SKYFIELD_DATA_DIR,
    STARS_FILENAME,
    ensure_output_dir,
    get_output_path,
)
from .hipparcos_catalog import filter_stars_by_magnitude, load_hipparcos_catalog
from .logging_utils import log, log_step
from .simbad_names import fetch_star_names
from .stellarium_lines import fetch_constellation_lines


def _assign_constellations(
    filtered_df,
    load: Loader
) -> List[str]:
    """
    Assign IAU constellation abbreviations to stars using Skyfield.
    
    Args:
        filtered_df: Pandas DataFrame with star data
        load: Skyfield Loader instance
        
    Returns:
        List of constellation abbreviations (same order as DataFrame)
        
    Note:
        Uses J2000 coordinates and official IAU constellation map.
        Serpens returns either "Ser" or may have variants - normalized later.
    """
    log_step("Assigning Constellations")
    
    # Load ephemeris and constellation map
    planets = load('de421.bsp')
    ts = load.timescale()
    
    star_objects = Star.from_dataframe(filtered_df)
    constellation_map = load_constellation_map()
    
    # Compute constellation for each star at J2000 epoch
    earth = planets['earth']
    observer_position = earth.at(ts.J2000)
    
    constellations = constellation_map(
        observer_position.observe(star_objects)
    )
    
    # Convert to list of strings
    constellation_list = [str(c) for c in constellations]
    
    log(f"Assigned {len(constellation_list)} stars to constellations", "success")
    return constellation_list


def _build_star_catalog(
    filtered_df,
    constellations: List[str],
    name_data: Dict[int, Dict[str, Optional[str]]]
) -> List[Dict]:
    """
    Construct final star catalog with all metadata.
    
    Args:
        filtered_df: Filtered Hipparcos DataFrame
        constellations: Constellation assignments per star
        name_data: Name resolution results from SIMBAD
        
    Returns:
        List of star dictionaries ready for JSON export
        
    Format:
        {
            "id": 12345,           # Hipparcos ID
            "p": "Rigel",          # Proper name (optional)
            "b": "Beta Orionis",   # Bayer designation (optional)
            "m": 0.18,             # Apparent magnitude
            "r": 5.24226,          # RA in hours (not degrees!)
            "d": -8.20164,         # Dec in degrees
            "c": "Ori"             # Constellation abbreviation
        }
    """
    log_step("Building Star Catalog")
    
    catalog = []
    
    for i, hip_id in enumerate(filtered_df.index):
        row = filtered_df.iloc[i]
        names = name_data.get(int(hip_id), {})
        
        star_entry = {
            "id": int(hip_id),
            "p": names.get('p'),  # Proper name (None if not found)
            "b": names.get('b'),  # Bayer name (None if not found)
            "m": round(float(row['magnitude']), 2),
            "r": round(float(row['ra_degrees']) / 15.0, 5),  # Convert deg -> hours
            "d": round(float(row['dec_degrees']), 5),
            "c": constellations[i]
        }
        
        catalog.append(star_entry)
    
    log(f"Catalog contains {len(catalog)} stars", "success")
    return catalog


def _write_json_file(data: any, output_path: Path, description: str) -> None:
    """
    Write data structure to JSON file with logging.
    
    Args:
        data: Python object to serialize
        output_path: Target file path
        description: Human-readable description for logging
    """
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    
    log(f"{description} written to {output_path}", "success")


def build_atlas(output_dir: Path = Path("web")) -> None:
    """
    Execute complete atlas build pipeline.
    
    Pipeline steps:
    1. Load Hipparcos star catalog
    2. Fetch constellation line definitions
    3. Filter stars (bright + line-required stars)
    4. Assign IAU constellations
    5. Resolve star names via SIMBAD
    6. Generate constellation boundaries
    7. Write JSON output files
    
    Args:
        output_dir: Directory for output files (default: "web")
        
    Outputs:
        - stars.json: Star catalog with names and positions
        - lines.json: Constellation stick figure line segments
        - boundaries.json: IAU constellation boundary polygons
        - names_cache.json: SIMBAD query cache (for reuse)
        
    Note:
        RA coordinates in output are in HOURS (not degrees).
        This is required by the Astronomy Engine library used by frontend.
        
    Raises:
        IOError: If file operations fail
        requests.HTTPError: If network requests fail
    """
    log_step("STELLAR OBSERVER ATLAS BUILDER", "Starting pipeline...")
    
    # Ensure output directory exists
    ensure_output_dir(output_dir)
    
    # Initialize Skyfield loader
    skyfield_data_path = Path(SKYFIELD_DATA_DIR)
    skyfield_data_path.mkdir(parents=True, exist_ok=True)
    load = Loader(SKYFIELD_DATA_DIR)
    
    # Step 1: Load Hipparcos
    hipparcos_df = load_hipparcos_catalog()
    
    # Step 2: Fetch constellation lines
    lines_by_const, required_hip_ids = fetch_constellation_lines()
    
    # Step 3: Filter stars
    filtered_df = filter_stars_by_magnitude(
        hipparcos_df,
        MAX_MAGNITUDE,
        required_hip_ids
    )
    
    # Step 4: Assign constellations
    constellations = _assign_constellations(filtered_df, load)
    
    # Step 5: Resolve names
    hip_ids_to_query = set(int(h) for h in filtered_df.index)
    cache_path = output_dir / NAMES_CACHE_FILENAME
    name_data = fetch_star_names(hip_ids_to_query, cache_path)
    
    # Step 6: Build catalog
    star_catalog = _build_star_catalog(filtered_df, constellations, name_data)
    
    # Step 7: Generate boundaries
    boundaries = generate_boundaries_j2000(skyfield_data_path)
    
    # Step 8: Write outputs
    log_step("Writing Output Files")
    
    _write_json_file(
        star_catalog,
        get_output_path(output_dir, STARS_FILENAME),
        "Star catalog"
    )
    
    _write_json_file(
        lines_by_const,
        get_output_path(output_dir, LINES_FILENAME),
        "Constellation lines"
    )
    
    _write_json_file(
        boundaries,
        get_output_path(output_dir, BOUNDARIES_FILENAME),
        "Constellation boundaries"
    )
    
    log("\n" + "="*50, "info")
    log("ATLAS BUILD COMPLETE", "success")
    log("="*50, "info")
    log(f"Output directory: {output_dir.absolute()}")
    log(f"Total stars: {len(star_catalog)}")
    log(f"Constellations with lines: {len(lines_by_const)}")
    log(f"Boundary polygons: {len(boundaries)}")