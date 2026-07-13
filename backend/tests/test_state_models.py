from __future__ import annotations

from datetime import date

import pytest
from pydantic import ValidationError

from stagepilot.models.state import (
    ServiceLoadState,
    ServiceLoadStatus,
    ServicePlanCandidate,
)

TARGET_DATE = date(2026, 7, 12)


def candidate(identifier: str, *, target_date: date = TARGET_DATE) -> ServicePlanCandidate:
    return ServicePlanCandidate(
        id=identifier,
        title=f"Service {identifier}",
        service_type_id="service-type-1",
        service_type_name="Weekend",
        target_date=target_date,
        service_times=["09:00"],
    )


def test_ambiguous_load_requires_at_least_two_candidates() -> None:
    with pytest.raises(ValidationError, match="requires at least two candidates"):
        ServiceLoadState(
            status=ServiceLoadStatus.AMBIGUOUS,
            target_date=TARGET_DATE,
            candidates=[candidate("plan-1")],
        )


def test_candidates_are_rejected_outside_an_ambiguous_load() -> None:
    with pytest.raises(ValidationError, match="only valid for an ambiguous load state"):
        ServiceLoadState(
            status=ServiceLoadStatus.ERROR,
            target_date=TARGET_DATE,
            candidates=[candidate("plan-1"), candidate("plan-2")],
        )


def test_ambiguous_candidates_must_match_the_target_date() -> None:
    with pytest.raises(ValidationError, match="must match the service-load target date"):
        ServiceLoadState(
            status=ServiceLoadStatus.AMBIGUOUS,
            target_date=TARGET_DATE,
            candidates=[
                candidate("plan-1"),
                candidate("plan-2", target_date=date(2026, 7, 13)),
            ],
        )


def test_loaded_state_requires_a_date_and_cannot_be_stale_or_ambiguous() -> None:
    valid = ServiceLoadState(status=ServiceLoadStatus.LOADED, target_date=TARGET_DATE)
    assert valid.is_stale is False
    assert valid.candidates == []

    with pytest.raises(ValidationError, match="requires a target date"):
        ServiceLoadState(status=ServiceLoadStatus.LOADED)
    with pytest.raises(ValidationError, match="successfully loaded service cannot retain"):
        ServiceLoadState(
            status=ServiceLoadStatus.LOADED,
            target_date=TARGET_DATE,
            is_stale=True,
        )
    with pytest.raises(ValidationError, match="only valid for an ambiguous load state"):
        ServiceLoadState(
            status=ServiceLoadStatus.LOADED,
            target_date=TARGET_DATE,
            candidates=[candidate("plan-1"), candidate("plan-2")],
        )


@pytest.mark.parametrize(
    "status",
    [
        ServiceLoadStatus.LOADING,
        ServiceLoadStatus.LOADED,
        ServiceLoadStatus.NOT_FOUND,
        ServiceLoadStatus.AMBIGUOUS,
        ServiceLoadStatus.ERROR,
    ],
)
def test_every_non_idle_load_requires_a_target_date(status: ServiceLoadStatus) -> None:
    with pytest.raises(ValidationError, match="requires a target date"):
        ServiceLoadState(status=status)


def test_idle_load_rejects_a_target_date() -> None:
    with pytest.raises(ValidationError, match="idle service-load state cannot have a target date"):
        ServiceLoadState(status=ServiceLoadStatus.IDLE, target_date=TARGET_DATE)


@pytest.mark.parametrize(
    "status",
    [ServiceLoadStatus.NOT_FOUND, ServiceLoadStatus.ERROR],
)
def test_completed_failure_can_retain_a_same_day_stale_plan(status: ServiceLoadStatus) -> None:
    state = ServiceLoadState(status=status, target_date=TARGET_DATE, is_stale=True)

    assert state.is_stale is True


def test_ambiguity_can_retain_a_same_day_stale_plan() -> None:
    state = ServiceLoadState(
        status=ServiceLoadStatus.AMBIGUOUS,
        target_date=TARGET_DATE,
        candidates=[candidate("plan-1"), candidate("plan-2")],
        is_stale=True,
    )

    assert state.is_stale is True


def test_loading_can_retain_a_same_day_stale_plan() -> None:
    state = ServiceLoadState(
        status=ServiceLoadStatus.LOADING,
        target_date=TARGET_DATE,
        is_stale=True,
    )

    assert state.is_stale is True


@pytest.mark.parametrize(
    "status",
    [ServiceLoadStatus.IDLE, ServiceLoadStatus.LOADED],
)
def test_idle_or_successful_load_cannot_be_stale(status: ServiceLoadStatus) -> None:
    target_date = None if status is ServiceLoadStatus.IDLE else TARGET_DATE
    with pytest.raises(ValidationError, match="successfully loaded service cannot retain"):
        ServiceLoadState(status=status, target_date=target_date, is_stale=True)
