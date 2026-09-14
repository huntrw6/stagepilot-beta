"""Structured application logging configuration."""

from __future__ import annotations

import logging
import re
import sys
from typing import Any, cast

import structlog

_SENSITIVE_KEY = re.compile(r"(?:authorization|cookie|credential|password|secret|token)", re.I)
_SENSITIVE_TEXT = re.compile(
    r"(?i)(bearer\s+|basic\s+|(?:password|secret|token|api[_-]?key)\s*[=:]\s*)[^\s,;&]+"
)


def _redact(value: object, key: str = "") -> object:
    """Recursively remove common credentials before structured log rendering."""

    if _SENSITIVE_KEY.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {item_key: _redact(item, str(item_key)) for item_key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_redact(item) for item in value]
    if isinstance(value, str):
        return _SENSITIVE_TEXT.sub(lambda match: match.group(1) + "[REDACTED]", value)
    return value


def redact_secrets(
    _logger: object, _method_name: str, event_dict: dict[str, object]
) -> dict[str, object]:
    """Structlog processor that preserves diagnostics without leaking credentials."""

    return {key: _redact(value, key) for key, value in event_dict.items()}


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
        redact_secrets,
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
