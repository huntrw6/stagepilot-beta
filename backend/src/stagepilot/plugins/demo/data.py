"""Deterministic sample service data used by demo mode and UI development."""

from __future__ import annotations

from datetime import date

from stagepilot.models.state import ServicePlan, Song


def demo_service_plan(service_date: date | None = None) -> ServicePlan:
    """Return a fresh copy of the built-in StagePilot demonstration plan."""

    return ServicePlan(
        id="demo-service-plan",
        title="Sunday Worship — Demo",
        date=service_date or date.today(),
        service_type="Weekend Services",
        service_times=["09:00", "11:00"],
        duration_source="Demo scheduled item length",
        songs=[
            Song(id="demo-battle-belongs", title="Battle Belongs", duration_seconds=281, order=1),
            Song(id="demo-holy-forever", title="Holy Forever", duration_seconds=336, order=2),
            Song(id="demo-gratitude", title="Gratitude", duration_seconds=352, order=3),
            Song(id="demo-firm-foundation", title="Firm Foundation", duration_seconds=377, order=4),
        ],
    )
