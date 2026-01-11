"""
Hipparcos star catalog loading and filtering.

Handles acquisition of the Hipparcos catalog via Skyfield, including
automatic caching and preprocessing. The catalog is the foundation
of the star atlas.
"""

import os
from pathlib import Path
from typing import Set

import pandas as pd
from skyfield.api import Loader
from skyfield.data import hipparcos

from .config import MAX_MAGNITUDE, SKYFIELD_DATA_DIR
from .logging_utils import log, log_step


def load_hipparcos_catalog() -> pd.DataFrame:
    """
    Download and load the complete Hipparcos star catalog.
    
    Uses Skyfield's built-in caching mechanism. First call downloads
    ~600KB file, subsequent calls use local cache.
    
    Returns:
        DataFrame with columns: ra_degrees, dec_degrees, magnitude, etc.
        Index is Hipparcos catalog number (HIP ID).
        
    Raises:
        IOError: If download fails or file is corrupted
        
    Note:
        Creates SKYFIELD_DATA_DIR if it doesn't exist.
    """
    log_step("Loading Hipparcos Catalog")
    
    if not os.path.exists(SKYFIELD_DATA_DIR):
        os.makedirs(SKYFIELD_DATA_DIR)
        log(f"Created cache directory: {SKYFIELD_DATA_DIR}")
    
    load = Loader(SKYFIELD_DATA_DIR)
    
    with load.open(hipparcos.URL) as f:
        df = hipparcos.load_dataframe(f)
    
    log(f"Loaded {len(df)} stars from Hipparcos catalog", "success")
    return df


def filter_stars_by_magnitude(
    df: pd.DataFrame,
    max_magnitude: float,
    required_hip_ids: Set[int]
) -> pd.DataFrame:
    """
    Filter catalog to visible stars plus stars required by constellation lines.
    
    Logic:
    - Include all stars brighter than max_magnitude
    - ALSO include dimmer stars if they appear in constellation stick figures
    - Drop stars with missing coordinates
    
    Args:
        df: Complete Hipparcos DataFrame
        max_magnitude: Magnitude threshold (lower = brighter)
        required_hip_ids: HIP IDs that must be kept regardless of magnitude
        
    Returns:
        Filtered DataFrame maintaining original index
        
    Why this matters:
        Without required_hip_ids, constellation lines would have missing
        endpoints and appear broken in the visualization.
        
    Example:
        >>> df = load_hipparcos_catalog()
        >>> required = {1234, 5678}  # From constellation lines
        >>> filtered = filter_stars_by_magnitude(df, 5.0, required)
    """
    log_step("Filtering Stars", f"magnitude ≤ {max_magnitude}")
    
    # Mask 1: Bright stars
    mask_bright = df['magnitude'] <= max_magnitude
    
    # Mask 2: Stars used in constellation lines
    mask_required = df.index.isin(required_hip_ids)
    
    # Combined: bright OR required
    combined_mask = mask_bright | mask_required
    
    # Drop rows with missing coordinates
    filtered_df = df[combined_mask].dropna(subset=['ra_degrees', 'dec_degrees'])
    
    bright_count = mask_bright.sum()
    required_count = (mask_required & ~mask_bright).sum()
    
    log(f"Selected {len(filtered_df)} stars:", "success")
    log(f"  • {bright_count} bright stars (mag ≤ {max_magnitude})")
    log(f"  • {required_count} additional stars for constellation lines")
    
    return filtered_df