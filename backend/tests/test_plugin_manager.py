from __future__ import annotations

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

    async def start(self) -> None:
        if self.fail:
            raise RuntimeError("intentional plugin failure")
        self.started = True

    async def stop(self) -> None:
        self.started = False

    async def health(self) -> PluginHealth:
        return PluginHealth(
            name=self.name,
            version=self.version,
            status=PluginStatus.RUNNING if self.started else PluginStatus.STOPPED,
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
    assert health["healthy"].status is PluginStatus.RUNNING
