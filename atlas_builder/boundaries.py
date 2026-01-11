"""
IAU constellation boundary generation with coordinate precession.

Transforms official constellation boundaries from B1875 (FK4) to J2000 (ICRS)
coordinates suitable for modern visualization.
"""

import os
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import requests

from .config import (
    CDS_BOUNDARIES_URL,
    BOUNDARY_DENSIFICATION_STEPS,
    BOUNDARY_GAP_THRESHOLD_SQ,
    SKYFIELD_DATA_DIR,
    SIMBAD_TIMEOUT_SECONDS
)
from .logging_utils import log, log_step


# Check for Astropy availability at module load
try:
    from astropy.coordinates import FK4, SkyCoord
    import astropy.units as u
    HAS_ASTROPY = True
except ImportError:
    HAS_ASTROPY = False


def _download_boundary_data(data_dir: Path) -> Path:
    """
    Download IAU constellation boundary definition file.
    
    Args:
        data_dir: Directory for caching downloaded file
        
    Returns:
        Path to downloaded constbnd.dat file
        
    Note:
        File format is FK4 B1875 coordinates from CDS catalog VI/49.
    """
    boundary_path = data_dir / "constbnd.dat"
    
    if boundary_path.exists():
        log("Using cached boundary data")
        return boundary_path
    
    log(f"Downloading boundaries from {CDS_BOUNDARIES_URL}")
    
    response = requests.get(CDS_BOUNDARIES_URL, timeout=SIMBAD_TIMEOUT_SECONDS)
    response.raise_for_status()
    
    with open(boundary_path, 'wb') as f:
        f.write(response.content)
    
    log(f"Saved to {boundary_path}", "success")
    return boundary_path


def _parse_boundary_file(file_path: Path) -> Dict[str, List[Tuple[float, float]]]:
    """
    Parse constbnd.dat into constellation boundary polygons.
    
    File format (space-separated):
    RA_hours  Dec_degrees  Constellation_Abbr
    
    Args:
        file_path: Path to constbnd.dat
        
    Returns:
        Dict mapping constellation abbreviation to list of (RA, Dec) points
        
    Example:
        {"ORI": [(5.5, 10.0), (5.6, 10.0), ...], ...}
    """
    boundaries: Dict[str, List[Tuple[float, float]]] = {}
    
    with open(file_path, 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.split()
            
            if len(parts) < 3:
                continue
            
            try:
                ra_hours = float(parts[0])
                dec_degrees = float(parts[1])
                constellation = parts[2].upper().strip()
                
                if constellation not in boundaries:
                    boundaries[constellation] = []
                
                boundaries[constellation].append((ra_hours, dec_degrees))
            
            except ValueError:
                continue
    
    log(f"Parsed {len(boundaries)} constellation boundaries")
    return boundaries


def _densify_polygon(
    points: List[Tuple[float, float]],
    steps: int
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Interpolate additional points along polygon edges.
    
    Prevents visual gaps when boundaries cross large angular distances.
    Handles RA wraparound at 0h/24h boundary.
    
    Args:
        points: List of (RA_hours, Dec_degrees) tuples
        steps: Number of interpolation points per segment
        
    Returns:
        Tuple of (RA_array, Dec_array) with densified coordinates
        
    Why densify:
        Constellation boundaries are defined with sparse vertices.
        When projected to sky, long edges can appear curved or broken.
        Interpolation provides smooth curves after coordinate transformation.
    """
    ra_list: List[float] = []
    dec_list: List[float] = []
    
    for i in range(len(points)):
        p1 = points[i]
        p2 = points[(i + 1) % len(points)]
        
        # Handle RA wraparound (0h <-> 24h)
        ra1, dec1 = p1
        ra2, dec2 = p2
        
        ra_dist = ra2 - ra1
        if ra_dist > 12.0:
            ra2 -= 24.0
        elif ra_dist < -12.0:
            ra2 += 24.0
        
        # Check for discontinuous segments (e.g., Serpens split)
        dist_sq = (ra2 - ra1)**2 + (dec2 - dec1)**2
        
        if dist_sq > BOUNDARY_GAP_THRESHOLD_SQ:
            # Large gap - don't interpolate, just add the point
            ra_list.append((ra1 + 24) % 24)
            dec_list.append(dec1)
            continue
        
        # Interpolate segment
        for s in range(steps):
            t = s / steps
            ra_interp = ra1 + (ra2 - ra1) * t
            dec_interp = dec1 + (dec2 - dec1) * t
            
            ra_list.append((ra_interp + 24) % 24)
            dec_list.append(dec_interp)
    
    return np.array(ra_list), np.array(dec_list)


def _precess_coordinates(
    ra_hours: np.ndarray,
    dec_degrees: np.ndarray
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Precess coordinates from FK4 B1875 to ICRS J2000.
    
    Args:
        ra_hours: Right Ascension in hours
        dec_degrees: Declination in degrees
        
    Returns:
        Tuple of (RA_hours_J2000, Dec_degrees_J2000)
        
    Note:
        Falls back to identity transform if Astropy unavailable.
        Accuracy without Astropy: ~arcminutes (acceptable for visualization).
    """
    if not HAS_ASTROPY or len(ra_hours) == 0:
        if not HAS_ASTROPY:
            log("Astropy unavailable - skipping precession", "warn")
        return ra_hours, dec_degrees
    
    # Convert to Astropy SkyCoord
    coord_b1875 = SkyCoord(
        ra=ra_hours * u.hourangle,
        dec=dec_degrees * u.deg,
        frame=FK4(equinox='B1875')
    )
    
    # Transform to ICRS (equivalent to J2000 for most purposes)
    coord_icrs = coord_b1875.icrs
    
    return coord_icrs.ra.hour, coord_icrs.dec.deg


def generate_boundaries_j2000(data_dir: Path) -> Dict[str, List[List[float]]]:
    """
    Generate constellation boundaries in J2000 coordinates.
    
    Pipeline:
    1. Download IAU boundary definitions (B1875 coordinates)
    2. Parse into polygons per constellation
    3. Densify polygon edges via interpolation
    4. Precess from B1875 to J2000
    5. Round and format for JSON export
    
    Args:
        data_dir: Directory for caching boundary data
        
    Returns:
        Dict mapping constellation abbreviation to boundary points:
        {"ORI": [[5.5123, 10.234], [5.5234, 10.456], ...], ...}
        
    Output format:
        - RA in hours (not degrees)
        - Dec in degrees
        - Points form closed polygons (last connects to first)
        
    Raises:
        requests.HTTPError: If download fails
        IOError: If file operations fail
    """
    log_step("Generating Constellation Boundaries")
    
    if not HAS_ASTROPY:
        log("⚠ Astropy not installed - boundaries will use B1875 coordinates", "warn")
        log("  Install astropy for accurate J2000 precession")
    
    # Ensure data directory exists
    data_path = Path(data_dir)
    data_path.mkdir(parents=True, exist_ok=True)
    
    # Download and parse
    boundary_file = _download_boundary_data(data_path)
    raw_boundaries = _parse_boundary_file(boundary_file)
    
    # Process each constellation
    boundaries_j2000: Dict[str, List[List[float]]] = {}
    
    for constellation, points in raw_boundaries.items():
        # Densify
        ra_dense, dec_dense = _densify_polygon(points, BOUNDARY_DENSIFICATION_STEPS)
        
        # Precess
        ra_j2000, dec_j2000 = _precess_coordinates(ra_dense, dec_dense)
        
        # Format for JSON: [[RA, Dec], [RA, Dec], ...]
        formatted_points = [
            [round(float(ra), 5), round(float(dec), 5)]
            for ra, dec in zip(ra_j2000, dec_j2000)
        ]
        
        boundaries_j2000[constellation] = formatted_points
    
    log(f"Generated {len(boundaries_j2000)} boundary polygons", "success")
    return boundaries_j2000