"""A user module that blows up at import time.

Exists to prove run_extract's broad except: discovery imports arbitrary user
code, so the raisable set is unbounded and one bad module must not abort the
batch. ValueError is deliberately not an import-related exception type.
"""

raise ValueError("this module is intentionally broken")
