"""Where Nooklane keeps its files at runtime.

Everything lives outside the project dir, so writing it never triggers a
Reflex hot reload:

* ``spaces/``  - one JSON file per space (its map and settings)
* ``livekit/`` - the embedded LiveKit server's binary, keys, config and log

``NOOKLANE_DATA_DIR`` moves all of it.  The default is
``~/Library/Application Support/nooklane`` on macOS and
``~/.local/share/nooklane`` on Linux; the re-ddns catalog entry mounts a named
Docker volume there, so spaces survive a reinstall.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _default_dir() -> Path:
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / "nooklane"


DATA_DIR = Path(os.environ.get("NOOKLANE_DATA_DIR") or _default_dir())
SPACES_DIR = DATA_DIR / "spaces"
