"""
Configuration constants for the atlas builder pipeline.

Centralizes all magic numbers, file paths, and thresholds to make
build behavior explicit and easily modifiable.
"""

from pathlib import Path
from typing import Final


# --- Output Configuration ---
DEFAULT_OUTPUT_DIR: Final[Path] = Path("web")
STARS_FILENAME: Final[str] = "stars.json"
BOUNDARIES_FILENAME: Final[str] = "boundaries.json"
LINES_FILENAME: Final[str] = "lines.json"
NAMES_CACHE_FILENAME: Final[str] = "names_cache.json"

# --- Catalog Filtering ---
MAX_MAGNITUDE: Final[float] = 6.0
"""
Maximum apparent magnitude for stars to include in catalog.
Lower values = brighter stars only.
"""

MIN_ALTITUDE_DEGREES: Final[float] = 3.0
"""
Minimum altitude above horizon for rendering (not used in build, 
but documented here as the frontend default).
"""

# --- Data Sources ---
SKYFIELD_DATA_DIR: Final[str] = "skyfield_data"
"""Local cache directory for Skyfield ephemeris and catalog files."""

# --- Data Sources ---
SKYFIELD_DATA_DIR: Final[str] = "skyfield_data"
"""Local cache directory for Skyfield ephemeris and catalog files."""

STELLARIUM_SKYCULTURE: Final[str] = "modern"
"""
Stellarium skyculture to use for constellation lines.
Options:
  - "modern_st": Simplified stick figures (fewer lines, cleaner)
  - "modern": Traditional Western figures (more detailed)
"""

def get_stellarium_lines_url() -> str:
    """
    Get Stellarium constellation lines URL based on configured skyculture.
    
    Returns:
        Full GitHub URL to the index.json file
    """
    return (
        f"https://raw.githubusercontent.com/Stellarium/stellarium/"
        f"refs/heads/master/skycultures/{STELLARIUM_SKYCULTURE}/index.json"
    )

CDS_BOUNDARIES_URL: Final[str] = (
    "https://cdsarc.cds.unistra.fr/ftp/VI/49/constbnd.dat"
)

# --- SIMBAD Query Configuration ---
SIMBAD_CHUNK_SIZE: Final[int] = 500
"""Number of stars to query per SIMBAD batch request."""

SIMBAD_TIMEOUT_SECONDS: Final[int] = 30
"""HTTP timeout for SIMBAD queries."""

# --- Boundary Processing ---
BOUNDARY_DENSIFICATION_STEPS: Final[int] = 10
"""
Number of interpolation points per boundary segment.
Higher values = smoother boundaries but larger file size.
"""

BOUNDARY_GAP_THRESHOLD_SQ: Final[float] = 100.0
"""
Squared distance threshold for detecting discontinuous boundary segments.
Used to handle split constellations like Serpens.
"""

# --- Coordinate Systems ---
# Note: Output RA is in HOURS (not degrees) for Astronomy Engine compatibility
RA_WRAP_HOURS: Final[float] = 24.0
DEGREES_PER_HOUR: Final[float] = 15.0


def ensure_output_dir(output_dir: Path) -> None:
    """
    Create output directory if it doesn't exist.
    
    Args:
        output_dir: Path to output directory
        
    Raises:
        OSError: If directory creation fails
    """
    output_dir.mkdir(parents=True, exist_ok=True)


def get_output_path(output_dir: Path, filename: str) -> Path:
    """
    Construct full output path for a generated file.
    
    Args:
        output_dir: Base output directory
        filename: Target filename (e.g., 'stars.json')
        
    Returns:
        Complete Path object for output file
        
    Example:
        >>> get_output_path(Path('web'), 'stars.json')
        PosixPath('web/stars.json')
    """
    return output_dir / filename