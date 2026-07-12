"""Structured application logging configuration."""

from __future__ import annotations

import logging
import sys
from typing import Any, cast

import structlog


def configure_logging(level: str = "INFO") -> None:
    """Configure stdlib and structlog to emit machine-readable JSON lines."""

    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, level.upper(), logging.INFO),
        stream=sys.stdout,
        force=True,
    )
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    structlog.configure(
        processors=[*shared_processors, structlog.processors.JSONRenderer()],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(component: str) -> structlog.stdlib.BoundLogger:
    """Return a logger permanently tagged with its StagePilot component."""

    return cast(structlog.stdlib.BoundLogger, structlog.get_logger(component=component))
