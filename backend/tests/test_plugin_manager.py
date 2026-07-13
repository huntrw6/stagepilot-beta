from __future__ import annotations

from datetime import UTC, datetime

from stagepilot.core.event_bus import EventBus
from stagepilot.core.plugin import Plugin, PluginManager
from stagepilot.core.state import StateStore
from stagepilot.models.state import PluginHealth, PluginStatus


class TestPlugin(Plugin):
    __test__ = False
    version = "1.0.0"

    def __init__(
        self,
        name: str,
        event_bus: EventBus,
        state_store: StateStore,
        *,
        fail: bool,
    ) -> None:
        super().__init__(event_bus, state_store)
        self.name = name
        self.fail = fail
        self.started = False
        self.health_calls = 0
        self.reported_status: PluginStatus | None = None
        self.reported_error: str | None = None
        self.reported_activity_at: datetime | None = None
        self.health_failure: Exception | None = None

    async def start(self) -> None:
        if self.fail:
            raise RuntimeError("intentional plugin failure")
        self.started = True

    async def stop(self) -> None:
        self.started = False

    async def health(self) -> PluginHealth:
        self.health_calls += 1
        if self.health_failure is not None:
            raise self.health_failure
        return PluginHealth(
            name=self.name,
            version=self.version,
            status=(
                self.reported_status
                if self.reported_status is not None
                else PluginStatus.RUNNING
                if self.started
                else PluginStatus.STOPPED
            ),
            last_error=self.reported_error,
            last_activity_at=self.reported_activity_at,
        )


async def test_plugin_start_failure_does_not_stop_healthy_plugin() -> None:
    bus = EventBus()
    store = StateStore()
    manager = PluginManager(bus)
    broken = TestPlugin("broken", bus, store, fail=True)
    healthy = TestPlugin("healthy", bus, store, fail=False)
    manager.register(broken)
    manager.register(healthy)

    await manager.start_all()
    health = {plugin.name: plugin for plugin in await manager.health()}

    assert healthy.started is True
    assert health["broken"].status is PluginStatus.ERROR
    assert health["broken"].last_error == "intentional plugin failure"
    assert broken.health_calls == 0
    assert health["healthy"].status is PluginStatus.RUNNING


async def test_health_uses_live_plugin_report_after_successful_start() -> None:
    bus = EventBus()
    store = StateStore()
    manager = PluginManager(bus)
    plugin = TestPlugin("live", bus, store, fail=False)
    manager.register(plugin)
    await manager.start_all()
    activity_at = datetime(2026, 7, 12, 17, 30, tzinfo=UTC)
    plugin.reported_error = "runtime integration failure"
    plugin.reported_activity_at = activity_at

    health = (await manager.health())[0]

    assert plugin.health_calls == 1
    assert health.status is PluginStatus.RUNNING
    assert health.last_error == "runtime integration failure"
    assert health.last_activity_at == activity_at


async def test_health_probe_failure_is_isolated_and_reported_safely() -> None:
    bus = EventBus()
    store = StateStore()
    manager = PluginManager(bus)
    broken = TestPlugin("broken", bus, store, fail=False)
    healthy = TestPlugin("healthy", bus, store, fail=False)
    manager.register(broken)
    manager.register(healthy)
    await manager.start_all()
    broken.health_failure = RuntimeError("private probe detail")

    health = {plugin.name: plugin for plugin in await manager.health()}

    assert health["broken"].status is PluginStatus.ERROR
    assert health["broken"].last_error == "Plugin health check failed."
    assert "private probe detail" not in health["broken"].model_dump_json()
    assert health["healthy"].status is PluginStatus.RUNNING
    assert healthy.health_calls == 1
