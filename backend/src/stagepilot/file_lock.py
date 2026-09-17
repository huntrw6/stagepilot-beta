"""One shared cross-platform exclusive file lock.

`fcntl` does not exist on Windows and `msvcrt` does not exist on POSIX, so both
imports must stay inside the platform branch and be accessed through a typed
`Any` alias. Importing either at module scope crashes the other platform at
import time, and a bare attribute access fails type checking on the platform
where the module is absent.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, cast


@contextmanager
def exclusive_lock(path: Path) -> Iterator[None]:
    """Hold a one-byte exclusive process lock on Unix and Windows."""

    descriptor = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        if os.name == "nt":
            import msvcrt

            windows_lock = cast(Any, msvcrt)
            if os.fstat(descriptor).st_size == 0:
                os.write(descriptor, b"\0")
            os.lseek(descriptor, 0, os.SEEK_SET)
            windows_lock.locking(descriptor, windows_lock.LK_LOCK, 1)
        else:
            import fcntl

            posix_lock = cast(Any, fcntl)
            posix_lock.flock(descriptor, posix_lock.LOCK_EX)
        try:
            yield
        finally:
            if os.name == "nt":
                import msvcrt

                windows_lock = cast(Any, msvcrt)
                os.lseek(descriptor, 0, os.SEEK_SET)
                windows_lock.locking(descriptor, windows_lock.LK_UNLCK, 1)
            else:
                import fcntl

                posix_lock = cast(Any, fcntl)
                posix_lock.flock(descriptor, posix_lock.LOCK_UN)
    finally:
        os.close(descriptor)
