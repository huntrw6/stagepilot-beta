"""Local-network dashboard PIN authentication."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

DEFAULT_DASHBOARD_PIN = "1234"
PIN_ITERATIONS = 210_000
SESSION_TTL = timedelta(hours=12)


def hash_dashboard_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, PIN_ITERATIONS)
    return "$".join(
        (
            "pbkdf2_sha256",
            str(PIN_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode(),
            base64.urlsafe_b64encode(digest).decode(),
        )
    )


def verify_dashboard_pin(pin: str, encoded: str | None) -> bool:
    if encoded is None:
        return hmac.compare_digest(pin, DEFAULT_DASHBOARD_PIN)
    try:
        algorithm, iterations, salt, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            pin.encode(),
            base64.urlsafe_b64decode(salt),
            int(iterations),
        )
        return hmac.compare_digest(
            base64.urlsafe_b64encode(digest).decode(),
            expected,
        )
    except (ValueError, TypeError):
        return False


class DashboardSessionStore:
    """Keep short-lived browser sessions in memory without exposing PIN data."""

    def __init__(self) -> None:
        self._sessions: dict[str, datetime] = {}

    def create(self) -> str:
        token = secrets.token_urlsafe(32)
        self._sessions[token] = datetime.now(UTC) + SESSION_TTL
        return token

    def valid(self, token: str | None) -> bool:
        if not token:
            return False
        expires_at = self._sessions.get(token)
        if expires_at is None:
            return False
        if expires_at <= datetime.now(UTC):
            self._sessions.pop(token, None)
            return False
        return True

    def clear(self) -> None:
        self._sessions.clear()
