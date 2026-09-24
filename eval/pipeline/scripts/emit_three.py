#!/usr/bin/env python3
"""Headline trio emitter. Delegates to emit_gamecraft.py."""
from pathlib import Path
import runpy

if __name__ == "__main__":
    runpy.run_path(str(Path(__file__).resolve().parent / "emit_gamecraft.py"), run_name="__main__")
