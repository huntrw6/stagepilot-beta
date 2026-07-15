from __future__ import annotations

import pytest
from pydantic import ValidationError

from stagepilot.core.config import PlanningCenterSettings, Settings, get_settings


def test_incomplete_planning_center_credentials_are_valid_for_onboarding() -> None:
    settings = PlanningCenterSettings(app_id="app-id")

    assert settings.is_configured is False
    with pytest.raises(ValueError, match="not configured"):
        settings.credentials()


def test_planning_center_secrets_are_masked() -> None:
    settings = PlanningCenterSettings(app_id="private-app-id", secret="private-secret")

    rendered = f"{settings!r}\n{settings.model_dump_json()}"

    assert settings.is_configured is True
    assert "private-app-id" not in rendered
    assert "private-secret" not in rendered
    assert "**********" in rendered


def test_settings_reject_unknown_timezone() -> None:
    with pytest.raises(ValidationError, match="Unknown IANA timezone"):
        Settings(timezone="Not/A-Timezone")


def test_planning_center_lookahead_is_bounded_and_can_be_disabled() -> None:
    settings = PlanningCenterSettings(upcoming_lookahead_days=0)

    assert settings.upcoming_lookahead_days == 0
    with pytest.raises(ValidationError):
        PlanningCenterSettings(upcoming_lookahead_days=366)


def test_environment_loads_planning_center_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STAGEPILOT_PCO_APP_ID", "environment-app-id")
    monkeypatch.setenv("STAGEPILOT_PCO_SECRET", "environment-secret")
    monkeypatch.setenv("STAGEPILOT_PCO_SERVICE_TYPE_ID", "42")
    monkeypatch.setenv("STAGEPILOT_PCO_LOOKAHEAD_DAYS", "45")
    monkeypatch.setenv("STAGEPILOT_PCO_TIMEOUT_SECONDS", "15")
    monkeypatch.setenv("STAGEPILOT_TIMEZONE", "America/New_York")
    get_settings.cache_clear()
    try:
        settings = get_settings()
    finally:
        get_settings.cache_clear()

    assert settings.timezone == "America/New_York"
    assert settings.planning_center.is_configured is True
    assert settings.planning_center.service_type_id == "42"
    assert settings.planning_center.upcoming_lookahead_days == 45
    assert settings.planning_center.request_timeout_seconds == 15
    assert settings.planning_center.credentials() == (
        "environment-app-id",
        "environment-secret",
    )
