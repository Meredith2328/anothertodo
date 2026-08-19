"""Runtime setup shared by the source command and the frozen executable."""
from __future__ import annotations

import os
import sys


def configure_utf8_output() -> None:
    """Keep Chinese text and UI symbols printable in legacy Windows consoles."""
    os.environ.setdefault("PYTHONUTF8", "1")
    for stream in (sys.stdout, sys.stderr):
        encoding = getattr(stream, "encoding", "") or ""
        if encoding.lower() not in ("utf-8", "utf8"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (AttributeError, OSError):
                # Some embedded / redirected streams cannot be reconfigured.
                pass
