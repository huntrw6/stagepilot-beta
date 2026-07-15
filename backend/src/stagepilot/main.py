"""FastAPI application factory and command-line entry point."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from stagepilot.api.routes import router as api_router
from stagepilot.api.websocket import router as websocket_router
from stagepilot.core.config import MidiSource, ServiceSource, Settings, TimerOutput, get_settings
from stagepilot.core.event_bus import EventBus
from stagepilot.core.events import EventType, new_event
from stagepilot.core.logging import configure_logging, get_logger
from stagepilot.core.plan_cache import (
    FilePlanCacheStore,
    MemoryPlanCacheStore,
    PlanCacheStore,
    default_plan_cache_path,
)
from stagepilot.core.plugin import PluginManager
from stagepilot.core.runtime import Runtime
from stagepilot.core.settings import SettingsService
from stagepilot.core.state import StateStore
from stagepilot.plugins.demo import DemoPlugin
from stagepilot.plugins.lights import LightsPlugin, MidiOutputBackendFactory
from stagepilot.plugins.midi_playback import MidiBackendFactory, MidiPlaybackPlugin
from stagepilot.plugins.planning_center import (
    PlanningCenterClientFactory,
    PlanningCenterPlugin,
    TodayProvider,
)
from stagepilot.plugins.propresenter import ProPresenterClientFactory, ProPresenterPlugin
from stagepilot.services.planning_center_setup import PlanningCenterSetupService
from stagepilot.services.state_service import StateService


def create_app(
    settings: Settings | None = None,
    *,
    planning_center_client_factory: PlanningCenterClientFactory | None = None,
    planning_center_today_provider: TodayProvider | None = None,
    midi_backend_factory: MidiBackendFactory | None = None,
    lights_backend_factory: MidiOutputBackendFactory | None = None,
    propresenter_client_factory: ProPresenterClientFactory | None = None,
    settings_service: SettingsService | None = None,
    plan_cache_store: PlanCacheStore | None = None,
) -> FastAPI:
    """Create an independently testable StagePilot application instance."""

    resolved_settings_service = settings_service or (
        SettingsService.ephemeral(settings) if settings is not None else SettingsService.default()
    )
    resolved_settings = settings or resolved_settings_service.load()
    configure_logging(resolved_settings.log_level)
    logger = get_logger("application")
    event_bus = EventBus()
    state_store = StateStore()
    state_service = StateService(
        event_bus,
        state_store,
        recent_event_limit=resolved_settings.recent_event_limit,
        recent_error_limit=resolved_settings.recent_error_limit,
    )
    plugin_manager = PluginManager(event_bus)
    midi_plugin: MidiPlaybackPlugin | None = None
    propresenter_plugin: ProPresenterPlugin | None = None
    lights_plugin = LightsPlugin(
        event_bus,
        state_store,
        resolved_settings.lights,
        backend_factory=lights_backend_factory,
    )
    plugin_manager.register(lights_plugin)
    resolved_plan_cache_store = plan_cache_store or (
        MemoryPlanCacheStore()
        if settings is not None
        else FilePlanCacheStore(default_plan_cache_path())
    )

    if resolved_settings.integration_modes.service_source is ServiceSource.DEMO:
        plugin_manager.register(
            DemoPlugin(
                event_bus,
                state_store,
                simulate_midi=(
                    resolved_settings.integration_modes.midi_source is MidiSource.SIMULATED
                ),
                simulate_propresenter=(
                    resolved_settings.integration_modes.timer_output is TimerOutput.SIMULATED
                ),
            )
        )
    else:
        plugin_manager.register(
            PlanningCenterPlugin(
                event_bus,
                state_store,
                resolved_settings.planning_center,
                timezone_name=resolved_settings.timezone,
                client_factory=planning_center_client_factory,
                today_provider=planning_center_today_provider,
                plan_cache_store=resolved_plan_cache_store,
            )
        )

    real_midi_enabled = (
        resolved_settings.midi.enabled
        and resolved_settings.integration_modes.midi_source is MidiSource.REAL
    )
    if real_midi_enabled:
        midi_plugin = MidiPlaybackPlugin(
            event_bus,
            state_store,
            resolved_settings.midi,
            state_service,
            backend_factory=midi_backend_factory,
        )
        plugin_manager.register(midi_plugin)

    real_propresenter_enabled = (
        resolved_settings.propresenter.enabled
        and resolved_settings.integration_modes.timer_output is TimerOutput.PROPRESENTER
    )
    if real_propresenter_enabled:
        propresenter_plugin = ProPresenterPlugin(
            event_bus,
            state_store,
            resolved_settings.propresenter,
            client_factory=propresenter_client_factory,
        )
        plugin_manager.register(propresenter_plugin)

    runtime = Runtime(
        settings=resolved_settings,
        event_bus=event_bus,
        state_store=state_store,
        state_service=state_service,
        plugin_manager=plugin_manager,
        settings_service=resolved_settings_service,
        planning_center_setup=PlanningCenterSetupService(
            resolved_settings_service,
            client_factory=planning_center_client_factory,
        ),
        midi_controller=midi_plugin,
        propresenter_controller=propresenter_plugin,
        lights_controller=lights_plugin,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info("application_starting", version=resolved_settings.version)
        await state_service.start()
        await plugin_manager.start_all()
        await event_bus.publish(new_event(EventType.APPLICATION_STARTED, source="application"))
        logger.info("application_started", version=resolved_settings.version)
        try:
            yield
        finally:
            logger.info("application_stopping")
            await event_bus.publish(new_event(EventType.APPLICATION_STOPPING, source="application"))
            await plugin_manager.stop_all()
            await state_service.stop()
            logger.info("application_stopped")

    application = FastAPI(
        title="StagePilot API",
        version=resolved_settings.version,
        lifespan=lifespan,
    )
    application.state.runtime = runtime
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5173",
            "http://localhost:5173",
            "http://tauri.localhost",
            "https://tauri.localhost",
            "tauri://localhost",
        ],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT"],
        allow_headers=["Content-Type"],
    )
    application.include_router(api_router)
    application.include_router(websocket_router)
    return application


app = create_app()


def run() -> None:
    settings = get_settings()
    uvicorn.run(
        "stagepilot.main:app",
        host=settings.bind_host,
        port=settings.bind_port,
        log_level=settings.log_level.casefold(),
    )


if __name__ == "__main__":
    run()
