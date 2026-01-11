"""
Command-line interface for atlas builder.

Provides stable entry point for running the build pipeline from terminal
or automation scripts.
"""

import argparse
import sys
from pathlib import Path

from .build_pipeline import build_atlas
from .config import DEFAULT_OUTPUT_DIR
from .logging_utils import log


def main() -> None:
    """
    Parse command-line arguments and execute build pipeline.
    
    Usage:
        python -m atlas_builder.cli --out web
        python -m atlas_builder.cli  # Uses default output directory
    """
    parser = argparse.ArgumentParser(
        description="Generate star atlas JSON files from astronomical catalogs",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python -m atlas_builder.cli
  python -m atlas_builder.cli --out my_atlas
  python -m atlas_builder.cli --out /var/www/stellar-atlas

Output files:
  stars.json       - Star catalog with positions and names
  lines.json       - Constellation line segments
  boundaries.json  - IAU constellation boundaries
  names_cache.json - SIMBAD query cache
        """
    )
    
    parser.add_argument(
        '--out', '--output',
        type=str,
        default=str(DEFAULT_OUTPUT_DIR),
        metavar='DIR',
        help=f'Output directory for generated files (default: {DEFAULT_OUTPUT_DIR})'
    )
    
    parser.add_argument(
        '--version',
        action='version',
        version='%(prog)s 1.0.0'
    )
    
    args = parser.parse_args()
    
    try:
        output_path = Path(args.out)
        
        log(f"Output directory: {output_path.absolute()}")
        log("Starting build pipeline...\n")
        
        build_atlas(output_path)
        
        log("\n✓ Build successful!")
        log(f"Files written to: {output_path.absolute()}")
        
        sys.exit(0)
    
    except KeyboardInterrupt:
        log("\n✗ Build interrupted by user", "error")
        sys.exit(130)
    
    except Exception as e:
        log(f"\n✗ Build failed: {e}", "error")
        
        # Print stack trace in debug mode
        import traceback
        traceback.print_exc()
        
        sys.exit(1)


if __name__ == '__main__':
    main()