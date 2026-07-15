from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from stagepilot.core.plan_cache import (
    CachedServicePlan,
    FilePlanCacheStore,
    PlanCacheError,
    default_plan_cache_path,
)
from stagepilot.models.state import ServicePlan, Song


def cached_plan() -> CachedServicePlan:
    return CachedServicePlan(
        plan=ServicePlan(
            id="plan-1",
            title="Sunday Morning",
            date=date(2026, 7, 19),
            service_type="Weekend Services",
            service_type_id="42",
            service_times=["09:00"],
            duration_source="Planning Center scheduled item length",
            songs=[
                Song(
                    id="item-1",
                    title="Holy Forever",
                    duration_seconds=336,
                    order=1,
                    source_song_id="song-1",
                )
            ],
        ),
        last_successful_refresh=datetime(2026, 7, 14, 18, tzinfo=UTC),
    )


def test_default_cache_path_sits_beside_windows_settings(tmp_path: Path) -> None:
    assert default_plan_cache_path({"APPDATA": str(tmp_path)}) == (
        tmp_path / "StagePilot" / "last-known-good-service.json"
    )


def test_cached_service_survives_a_new_store_instance(tmp_path: Path) -> None:
    path = tmp_path / "last-known-good-service.json"
    FilePlanCacheStore(path).save(cached_plan())

    restored = FilePlanCacheStore(path).load()

    assert restored == cached_plan()
    assert restored is not None
    assert restored.plan.songs[0].id == "item-1"
    assert restored.plan.songs[0].source_song_id == "song-1"


def test_corrupt_cache_fails_safely_without_being_overwritten(tmp_path: Path) -> None:
    path = tmp_path / "last-known-good-service.json"
    corrupt = "{not-json"
    path.write_text(corrupt, encoding="utf-8")

    with pytest.raises(PlanCacheError, match="corrupt or invalid"):
        FilePlanCacheStore(path).load()

    assert path.read_text(encoding="utf-8") == corrupt


def test_atomic_cache_failure_preserves_previous_data(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "last-known-good-service.json"
    store = FilePlanCacheStore(path)
    store.save(cached_plan())
    original = path.read_text(encoding="utf-8")

    def fail_replace(_source: Path, _destination: Path) -> None:
        raise OSError("simulated failure")

    monkeypatch.setattr("stagepilot.core.plan_cache.os.replace", fail_replace)

    with pytest.raises(PlanCacheError, match="atomically"):
        store.save(
            cached_plan().model_copy(
                update={"last_successful_refresh": datetime(2026, 7, 15, tzinfo=UTC)}
            )
        )

    assert path.read_text(encoding="utf-8") == original
    assert list(tmp_path.glob("*.tmp")) == []
