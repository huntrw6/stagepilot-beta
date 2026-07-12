"""Plugin lifecycle contracts and failure-isolated plugin manager."""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from datetime import UTC, datetime

from stagepilot.core.event_bus import EventBus
from stagepilot.core.events import EventType, PluginPayload, new_event
from stagepilot.core.logging import get_logger
from stagepilot.core.state import StateStore
from stagepilot.models.state import PluginHealth, PluginStatus


class Plugin(ABC):
    """Base contract implemented by every StagePilot integration."""

    name: str
    version: str

    def __init__(self, event_bus: EventBus, state_store: StateStore) -> None:
        self.event_bus = event_bus
        self.state_store = state_store

    @abstractmethod
    async def start(self) -> None:
        """Initialize resources and event subscriptions."""

    @abstractmethod
    async def stop(self) -> None:
        """Release resources and event subscriptions."""

    @abstractmethod
    async def health(self) -> PluginHealth:
        """Return the plugin's current health."""


class PluginManager:
    """Register and supervise plugins without allowing one failure to stop others."""

    def __init__(self, event_bus: EventBus) -> None:
        self._event_bus = event_bus
        self._plugins: dict[str, Plugin] = {}
        self._health: dict[str, PluginHealth] = {}
        self._logger = get_logger("plugin_manager")

    def register(self, plugin: Plugin) -> None:
        if plugin.name in self._plugins:
            msg = f"Plugin already registered: {plugin.name}"
            raise ValueError(msg)
        self._plugins[plugin.name] = plugin
        self._health[plugin.name] = PluginHealth(
            name=plugin.name,
            version=plugin.version,
            status=PluginStatus.STOPPED,
        )

    async def start_all(self) -> None:
        await asyncio.gather(*(self._start_plugin(plugin) for plugin in self._plugins.values()))

    async def stop_all(self) -> None:
        await asyncio.gather(
            *(self._stop_plugin(plugin) for plugin in reversed(self._plugins.values()))
        )

    async def health(self) -> list[PluginHealth]:
        return [value.model_copy(deep=True) for value in self._health.values()]

    async def _start_plugin(self, plugin: Plugin) -> None:
        await self._set_health(plugin, PluginStatus.STARTING)
        try:
            await plugin.start()
        except Exception as exc:  # plugin isolation is the purpose of this boundary
            self._logger.exception("plugin_start_failed", plugin=plugin.name)
            await self._set_health(plugin, PluginStatus.ERROR, str(exc))
            await self._event_bus.publish(
                new_event(
                    EventType.PLUGIN_FAILED,
                    source="plugin_manager",
                    payload=PluginPayload(
                        name=plugin.name,
                        version=plugin.version,
                        status=PluginStatus.ERROR,
                        error=str(exc),
                    ),
                )
            )
            return
        await self._set_health(plugin, PluginStatus.RUNNING)

    async def _stop_plugin(self, plugin: Plugin) -> None:
        health = self._health[plugin.name]
        if health.status is PluginStatus.STOPPED:
            return
        await self._set_health(plugin, PluginStatus.STOPPING)
        try:
            await plugin.stop()
        except Exception as exc:  # shutdown must continue for remaining plugins
            self._logger.exception("plugin_stop_failed", plugin=plugin.name)
            await self._set_health(plugin, PluginStatus.ERROR, str(exc))
            return
        await self._set_health(plugin, PluginStatus.STOPPED)

    async def _set_health(
        self,
        plugin: Plugin,
        status: PluginStatus,
        error: str | None = None,
    ) -> None:
        health = PluginHealth(
            name=plugin.name,
            version=plugin.version,
            status=status,
            last_error=error,
            last_activity_at=datetime.now(UTC),
        )
        self._health[plugin.name] = health
        await self._event_bus.publish(
            new_event(
                EventType.PLUGIN_STATUS_CHANGED,
                source="plugin_manager",
                payload=PluginPayload(
                    name=plugin.name,
                    version=plugin.version,
                    status=status,
                    error=error,
                ),
            )
        )
