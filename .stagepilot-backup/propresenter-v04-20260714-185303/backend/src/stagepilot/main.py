"""FastAPI application factory and command-line entry point."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from stagepilot.api.routes import router as api_router
from stagepilot.api.websocket import router as websocket_router
from stagepilot.core.config import Settings, get_settings
from stagepilot.core.event_bus import EventBus
from stagepilot.core.events import EventType, new_event
from stagepilot.core.logging import configure_logging, get_logger
from stagepilot.core.plugin import PluginManager
from stagepilot.core.runtime import Runtime
from stagepilot.core.state import StateStore
from stagepilot.plugins.demo import DemoPlugin
from stagepilot.plugins.midi_playback import MidiBackendFactory, MidiPlaybackPlugin
from stagepilot.plugins.planning_center import (
    PlanningCenterClientFactory,
    PlanningCenterPlugin,
    TodayProvider,
)
from stagepilot.plugins.propresenter import (
    ProPresenterClientFactory,
    ProPresenterPlugin,
)
from stagepilot.services.state_service import StateService


def create_app(
    settings: Settings | None = None,
    *,
    planning_center_client_factory: PlanningCenterClientFactory | None = None,
    planning_center_today_provider: TodayProvider | None = None,
    midi_backend_factory: MidiBackendFactory | None = None,
    propresenter_client_factory: ProPresenterClientFactory | None = None,
) -> FastAPI:
    """Create an independently testable StagePilot application instance."""

    resolved_settings = settings or get_settings()
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

    if resolved_settings.demo_mode:
        plugin_manager.register(
            DemoPlugin(
                event_bus,
                state_store,
                simulate_midi=resolved_settings.demo.simulate_midi,
                simulate_propresenter=resolved_settings.demo.simulate_propresenter,
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
            )
        )

    real_midi_enabled = resolved_settings.midi.enabled and (
        not resolved_settings.demo_mode or not resolved_settings.demo.simulate_midi
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

    real_propresenter_enabled = resolved_settings.propresenter.enabled and (
        not resolved_settings.demo_mode
        or not resolved_settings.demo.simulate_propresenter
    )
    if real_propresenter_enabled:
        plugin_manager.register(
            ProPresenterPlugin(
                event_bus,
                state_store,
                resolved_settings.propresenter,
                client_factory=propresenter_client_factory,
            )
        )

    runtime = Runtime(
        settings=resolved_settings,
        event_bus=event_bus,
        state_store=state_store,
        state_service=state_service,
        plugin_manager=plugin_manager,
        midi_controller=midi_plugin,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        logger.info("application_starting", version=resolved_settings.version)
        await state_service.start()
        await plugin_manager.start_all()
        await event_bus.publish(
            new_event(EventType.APPLICATION_STARTED, source="application")
        )
        logger.info("application_started", version=resolved_settings.version)
        try:
            yield
        finally:
            logger.info("application_stopping")
            await event_bus.publish(
                new_event(EventType.APPLICATION_STOPPING, source="application")
            )
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
        allow_methods=["GET", "POST"],
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
