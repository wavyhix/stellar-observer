"""
Logging utilities for the atlas builder pipeline.

Provides consistent, human-readable progress messages for long-running operations
like downloads, API queries, and data processing.
"""

from typing import Literal

LogLevel = Literal["info", "success", "warn", "error"]


def log(message: str, level: LogLevel = "info") -> None:
    """
    Print a formatted log message with visual indicator.
    
    Args:
        message: Human-readable status message
        level: Severity level affecting prefix symbol
        
    Example:
        >>> log("Downloading catalog", "info")
        ℹ Downloading catalog
        >>> log("Build complete", "success")
        ✓ Build complete
    """
    symbols = {
        "info": "ℹ",
        "success": "✓",
        "warn": "⚠",
        "error": "✗"
    }
    
    prefix = symbols.get(level, "•")
    print(f"{prefix} {message}")


def log_step(step_name: str, details: str = "") -> None:
    """
    Log a major pipeline step with optional details.
    
    Args:
        step_name: High-level operation name
        details: Additional context (optional)
        
    Example:
        >>> log_step("Loading Hipparcos", "filtering to mag 6.0")
        
        === Loading Hipparcos ===
        filtering to mag 6.0
    """
    print(f"\n=== {step_name} ===")
    if details:
        print(details)