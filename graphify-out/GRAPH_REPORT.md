# Graph Report - C:\Users\hunte\Documents\Visual Studio\Repository\stagepilot  (2026-07-14)

## Corpus Check
- 102 files · ~44,453 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1326 nodes · 3487 edges · 95 communities (66 shown, 29 thin omitted)
- Extraction: 74% EXTRACTED · 26% INFERRED · 0% AMBIGUOUS · INFERRED: 912 edges (avg confidence: 0.63)
- Token cost: 15,300 input · 6,710 output

## Community Hubs (Navigation)
- Event Bus Internals
- MIDI Action Control
- Planning Center Transport
- Application State Models
- MIDI Backend Interface
- Runtime Configuration Models
- API Route Handlers
- Mido Input Adapter
- Plan Discovery Tests
- MIDI Plugin Tests
- Planning Center Models
- Paginated API Requests
- Architecture Documentation
- Planning Center Client
- Domain Action Enums
- MIDI Selection API
- ProPresenter Data Models
- Frontend API Client
- TypeScript Compiler Config
- ProPresenter Output Plugin
- Plugin Base Contracts
- Event Bus API
- Application Factory Wiring
- ProPresenter Setup UI
- State Service Logic
- ProPresenter Controller
- Plan Loading Client
- Frontend Hook Tests
- Planning Center Settings
- ProPresenter API Tests
- State Service Tests
- ProPresenter HTTP Client
- Tauri Desktop Config
- Dashboard Components
- Environment Configuration
- Observable State Store
- Application Entry Testing
- Demo Integration Settings
- Frontend Build Dependencies
- ProPresenter Client Contract
- ProPresenter Settings
- Tauri Package Config
- ProPresenter Error Types
- React Package Config
- MIDI Setup UI
- Service Type Discovery
- Production State Fixtures
- Plugin Manager Tests
- Dashboard Component Tests
- Action Dispatcher Contract
- Frontend Package Scripts
- MIDI Port Test Doubles
- FastAPI Request Dependencies
- WebSocket State Stream
- Structured Logging
- Runtime Dependency Container
- Core Package Exports
- Backend Package Metadata
- Model Package Exports
- Demo Plugin Exports
- Plugin Package Exports
- MIDI Plugin Exports
- Planning Center Exports
- ProPresenter Package Exports
- ProPresenter Plugin Metadata
- Plugin Health Reporting
- Service Package Exports
- Changelog Versioning
- CI Reliability Policy
- ESLint Dependency
- ESLint JavaScript Rules
- React Hooks Linting
- React Refresh Linting
- Browser Globals Dependency
- JSDOM Test Runtime
- Tailwind CSS Dependency
- DOM Matcher Dependency
- User Event Testing
- React Type Definitions
- React DOM Types
- TypeScript ESLint Dependency
- Vitest Dependency
- Backend Project Metadata

## God Nodes (most connected - your core abstractions)
1. `EventBus` - 67 edges
2. `PlanningCenterClient` - 67 edges
3. `StateService` - 63 edges
4. `new_event()` - 59 edges
5. `StateStore` - 58 edges
6. `MidiPlaybackPlugin` - 55 edges
7. `PlanningCenterSettings` - 51 edges
8. `StagePilotEvent` - 51 edges
9. `ActionName` - 45 edges
10. `FakePlanningCenterClient` - 45 edges

## Surprising Connections (you probably didn't know these)
- `Configuration Precedence` --semantically_similar_to--> `Safe Configuration Boundary`  [INFERRED] [semantically similar]
  docs/configuration.md → ARCHITECTURE.md
- `Pixel-Art Airplane App Icon` --conceptually_related_to--> `StagePilot`  [INFERRED]
  desktop/app-icon.png → README.md
- `test_propresenter_settings_build_local_api_url()` --calls--> `ProPresenterSettings`  [INFERRED]
  backend/tests/test_propresenter_config.py → backend/src/stagepilot/core/config.py
- `test_settings_reject_unknown_timezone()` --calls--> `Settings`  [INFERRED]
  backend/tests/test_config.py → backend/src/stagepilot/core/config.py
- `run()` --calls--> `get_settings()`  [INFERRED]
  backend/src/stagepilot/main.py → backend/src/stagepilot/core/config.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **StagePilot Integration Event Flow** — docs_configuration_planning_center_discovery, docs_configuration_midi_cue_pipeline, docs_propresenter_timer_sequence, architecture_typed_event_bus [EXTRACTED 1.00]
- **Live Production Reliability Model** — architecture_plugin_isolation, docs_plugins_failure_containment, docs_propresenter_recovery_policy, contributing_live_production_reliability [INFERRED 0.85]
- **StagePilot Delivery Surfaces** — backend_readme_fastapi_application, frontend_index_dashboard_entry_document, architecture_frontend_desktop_boundaries [INFERRED 0.85]

## Communities (95 total, 29 thin omitted)

### Community 0 - "Event Bus Internals"
Cohesion: 0.06
Nodes (88): PublishReport, UUID, Failure-isolated in-process event bus., Subscribe to one event type, or all events when *event_type* is ``None``., Deliver an event concurrently and report failures without raising them., SubscriberFailure, Subscription, ActionPayload (+80 more)

### Community 1 - "MIDI Action Control"
Cohesion: 0.07
Nodes (27): ActionOutcome, Result returned after the state service handles one domain action., MidiController, MidiInputInfo, MidiInputSnapshot, MidiMonitorMessage, Protocol, Vendor-neutral contracts exposed by the MIDI Playback integration. (+19 more)

### Community 2 - "Planning Center Transport"
Cohesion: 0.09
Nodes (19): ServicePayload, AsyncBaseTransport, PlanningCenterConfigurationError, Required Planning Center configuration is absent or invalid., _local_today(), PlanningCenterClientContract, PlanningCenterPlugin, ApplicationState (+11 more)

### Community 3 - "Application State Models"
Cohesion: 0.07
Nodes (40): ApplicationState, ApplicationStatus, ConnectionStatus, ErrorSummary, EventSummary, PluginHealth, PluginStatus, BaseModel (+32 more)

### Community 4 - "MIDI Backend Interface"
Cohesion: 0.08
Nodes (21): _is_midi_integer(), MidiBackendContract, MidiInputPortContract, _normalize_message(), Protocol, Synchronous, typed boundary around Mido's MIDI input API., Translate one Mido message, dropping malformed or unsupported input., Minimal input-port surface owned by the MIDI plugin lifecycle. (+13 more)

### Community 5 - "Runtime Configuration Models"
Cohesion: 0.13
Nodes (25): MidiSettings, BaseModel, Validated runtime settings; integration secrets remain server-side only., Validated runtime settings for the Playback MIDI input., Settings, FakeMidiBackend, fixed_today(), LoadedPlanningCenterClient (+17 more)

### Community 6 - "API Route Handlers"
Cohesion: 0.14
Nodes (33): ActionResponse, _current_local_date(), health(), midi_inputs(), _midi_inputs_response(), midi_messages(), perform_action(), _production_service_ready() (+25 more)

### Community 7 - "Mido Input Adapter"
Cohesion: 0.11
Nodes (18): _MidoBackend, _MidoInputPort, MidoMidiBackend, MidiMessageCallback, Hide a Mido input port behind StagePilot's narrow lifecycle contract., Use Mido's RtMidi backend while emitting only validated note messages., BrokenMessage, FakeMidoBackend (+10 more)

### Community 8 - "Plan Discovery Tests"
Cohesion: 0.27
Nodes (31): PlanLoadedResult, PlanNotFoundResult, client_settings(), DiscoveryApi, item_resource(), LookaheadDiscoveryApi, mock_transport(), plan_resource() (+23 more)

### Community 9 - "MIDI Plugin Tests"
Cohesion: 0.20
Nodes (24): MidiNotePayload, connection_events(), DispatchCall, MutableClock, note_events(), plugin_harness(), PluginHarness, ActionName (+16 more)

### Community 10 - "Planning Center Models"
Cohesion: 0.10
Nodes (27): Song, CollectionLinks, ItemAttributes, ItemRelationships, ItemResource, NextPage, PaginationMeta, PlanAmbiguousResult (+19 more)

### Community 11 - "Paginated API Requests"
Cohesion: 0.11
Nodes (22): Any, PlanningCenterApiError, PlanningCenterAuthenticationError, PlanningCenterError, PlanningCenterPermissionError, PlanningCenterPlanSelectionError, PlanningCenterRateLimitError, PlanningCenterResponseError (+14 more)

### Community 12 - "Architecture Documentation"
Cohesion: 0.08
Nodes (31): Backend as Source of Truth, Frontend and Desktop Boundaries, Plugin Isolation, Safe Configuration Boundary, StagePilot Architecture, Typed Event Bus, Independently Runnable FastAPI Application, StagePilot Backend (+23 more)

### Community 13 - "Planning Center Client"
Cohesion: 0.17
Nodes (25): PlanningCenterClient, Call Planning Center with PAT authentication and safe error translation., Release the underlying connection pool., client_settings(), mock_transport(), Exception, Handler, JsonObject (+17 more)

### Community 14 - "Domain Action Enums"
Cohesion: 0.26
Nodes (26): ActionName, MidiCueName, MidiMessageDisposition, ActionName, StrEnum, ActionResponse, HealthResponse, MidiCueSimulationRequest (+18 more)

### Community 15 - "MIDI Selection API"
Cohesion: 0.18
Nodes (21): build_app(), FakeMidiBackend, fixed_today(), get_inputs(), input_id(), midi_note_event_count(), ApplicationState, date (+13 more)

### Community 16 - "ProPresenter Data Models"
Cohesion: 0.11
Nodes (14): ProPresenterCountdown, ProPresenterIdentifier, ProPresenterTimer, Any, BaseModel, Validated ProPresenter timer models., The API identity object ProPresenter uses for named resources., Countdown-specific timer settings. (+6 more)

### Community 17 - "Frontend API Client"
Cohesion: 0.23
Nodes (23): apiOrigin, configuredOrigin, getHealth(), getMidiInputs(), getMidiMessages(), getProPresenterStatus(), getState(), performAction() (+15 more)

### Community 18 - "TypeScript Compiler Config"
Cohesion: 0.08
Nodes (25): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+17 more)

### Community 19 - "ProPresenter Output Plugin"
Cohesion: 0.19
Nodes (8): SongPayload, TimerPayload, ProPresenterPlugin, ConnectionStatus, Exception, ProPresenterTimer, Apply validated settings for this backend session and reconnect immediately., Translate song lifecycle events into one reusable ProPresenter countdown.

### Community 20 - "Plugin Base Contracts"
Cohesion: 0.16
Nodes (12): ABC, PluginPayload, Plugin, PluginManager, PluginHealth, PluginStatus, Plugin lifecycle contracts and failure-isolated plugin manager., Base contract implemented by every StagePilot integration. (+4 more)

### Community 21 - "Event Bus API"
Cohesion: 0.12
Nodes (17): EventBus, Publish typed events to independent synchronous or asynchronous subscribers., Remove a subscription, returning whether it was still registered., get_logger(), Return a logger permanently tagged with its StagePilot component., MidiBackendFactory, PlanningCenterClientFactory, TodayProvider (+9 more)

### Community 22 - "Application Factory Wiring"
Cohesion: 0.19
Nodes (20): create_app(), MidiBackendFactory, PlanningCenterClientFactory, ProPresenterClientFactory, TodayProvider, Create an independently testable StagePilot application instance., FakePlanningCenterClient, fixed_today() (+12 more)

### Community 23 - "ProPresenter Setup UI"
Cohesion: 0.11
Nodes (20): ProPresenterSetupPanel(), statusTone(), status, ActionResponse, ApplicationStatus, ErrorSummary, EventSummary, MidiInput (+12 more)

### Community 24 - "State Service Logic"
Cohesion: 0.15
Nodes (6): ActionName, ServicePlan, UUID, Event-driven service plan navigation and state projection., Apply domain events to state and execute all navigation actions consistently., StateService

### Community 25 - "ProPresenter Controller"
Cohesion: 0.15
Nodes (9): ProPresenterController, ProPresenterSnapshot, ProPresenterTimerSummary, BaseModel, Protocol, Runtime contracts and observable snapshots for the ProPresenter integration., Safe timer metadata exposed to the dashboard., Current session configuration and discovery state. (+1 more)

### Community 26 - "Plan Loading Client"
Cohesion: 0.19
Nodes (8): date, datetime, PlanDiscoveryResult, ZoneInfo, Asynchronous, typed client for the Planning Center Services API., Load today's plan, or the nearest plan within the future search window., PlanResource, PlanTimeResource

### Community 27 - "Frontend Hook Tests"
Cohesion: 0.11
Nodes (14): health, midi, mockedGetHealth, mockedGetMidiInputs, mockedGetMidiMessages, mockedGetState, mockedPerformAction, mockedRefreshMidiInputs (+6 more)

### Community 28 - "Planning Center Settings"
Cohesion: 0.13
Nodes (10): PlanningCenterSettings, Validated server-side settings for Planning Center Personal Access Tokens., Treat empty environment values as absent credentials., Return a safe credential-presence flag without revealing either value., Return credentials only to trusted backend integrations., test_planning_center_credentials_must_be_configured_together(), test_planning_center_lookahead_is_bounded_and_can_be_disabled(), test_planning_center_secrets_are_masked() (+2 more)

### Community 29 - "ProPresenter API Tests"
Cohesion: 0.19
Nodes (8): enabled_settings(), FakeClient, make_timer(), ProPresenterTimer, RecordingFactory, test_disabled_propresenter_returns_safe_status(), test_propresenter_status_and_timer_refresh_are_exposed(), test_session_settings_recreate_client_and_report_missing_timer()

### Community 30 - "State Service Tests"
Cohesion: 0.35
Nodes (17): load(), make_plan(), ServicePlan, Song, song(), test_date_rollover_clears_plan_and_resets_running_timer(), test_empty_plan_actions_are_rejected_without_mutating_position(), test_first_and_last_song_bounds_are_safe() (+9 more)

### Community 31 - "ProPresenter HTTP Client"
Cohesion: 0.21
Nodes (6): ProPresenterClient, Any, Response, Small, typed boundary around ProPresenter's HTTP timer endpoints., ProPresenterResponseError, Raised when ProPresenter rejects or returns an invalid response.

### Community 32 - "Tauri Desktop Config"
Cohesion: 0.12
Nodes (16): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+8 more)

### Community 33 - "Dashboard Components"
Cohesion: 0.18
Nodes (11): App(), connectionDetail(), Dashboard(), formatDuration(), formatTime(), SongRow(), Status, StatusCard() (+3 more)

### Community 34 - "Environment Configuration"
Cohesion: 0.21
Nodes (11): _environment_bool(), _environment_optional(), _environment_optional_int(), get_settings(), MidiVelocityMappings, MidiCueName, Runtime configuration with environment-variable overrides., Configurable note-on velocity mappings for Playback cues. (+3 more)

### Community 35 - "Observable State Store"
Cohesion: 0.17
Nodes (7): ApplicationState, Queue, Concurrency-safe observable application state store., Own the current state and fan out immutable snapshots after each mutation., StateStore, service(), StateMutation

### Community 36 - "Application Entry Testing"
Cohesion: 0.16
Nodes (6): FastAPI, FastAPI application factory and command-line entry point., run(), FakeProPresenterClient, ProPresenterTimer, test_demo_plan_can_drive_real_propresenter_plugin()

### Community 37 - "Demo Integration Settings"
Cohesion: 0.18
Nodes (7): DemoSettings, Control which integrations are simulated while using the demo service plan., test_demo_integrations_remain_simulated_by_default(), test_propresenter_settings_build_local_api_url(), RecoveringClient, test_plugin_reconnects_when_propresenter_appears_after_startup(), test_stop_request_rediscovers_a_recreated_timer()

### Community 38 - "Frontend Build Dependencies"
Cohesion: 0.15
Nodes (13): autoprefixer, devDependencies, autoprefixer, postcss, @testing-library/react, typescript, vite, @vitejs/plugin-react (+5 more)

### Community 39 - "ProPresenter Client Contract"
Cohesion: 0.20
Nodes (4): ProPresenterClientContract, ProPresenterTimer, Protocol, Async HTTP client for the documented ProPresenter timer API.

### Community 40 - "ProPresenter Settings"
Cohesion: 0.22
Nodes (6): ProPresenterSettings, Validated runtime settings for ProPresenter's local HTTP API., AsyncBaseTransport, test_client_preserves_timer_identity_when_updating_duration(), test_client_rejects_missing_or_non_countdown_timer(), timer_payload()

### Community 41 - "Tauri Package Config"
Cohesion: 0.18
Nodes (10): description, devDependencies, @tauri-apps/cli, name, private, scripts, build, dev (+2 more)

### Community 42 - "ProPresenter Error Types"
Cohesion: 0.27
Nodes (9): ProPresenterConnectionError, ProPresenterError, ProPresenterTimerNotFoundError, ProPresenterTimerTypeError, Errors raised by the ProPresenter integration boundary., Raised when the ProPresenter API cannot be reached., Raised when the configured timer name cannot be found uniquely., Raised when the configured timer is not a countdown timer. (+1 more)

### Community 43 - "React Package Config"
Cohesion: 0.20
Nodes (9): dependencies, react, react-dom, name, private, type, version, react (+1 more)

### Community 44 - "MIDI Setup UI"
Cohesion: 0.29
Nodes (7): cues, MidiSetupPanel(), monitorTone(), midi, MidiCueName, MidiInputsResponse, MidiMonitorMessage

### Community 45 - "Service Type Discovery"
Cohesion: 0.22
Nodes (3): Return all available service types in their configured sequence., PlanningCenterServiceType, Service type information safe to expose to setup and selection interfaces.

### Community 46 - "Production State Fixtures"
Cohesion: 0.31
Nodes (8): ApplicationState, date, ServicePlan, _ready_production_plan(), _ready_production_state(), test_production_service_readiness_accepts_clean_upcoming_plan(), test_production_service_readiness_rejects_loaded_past_plan(), test_production_service_readiness_rejects_unusable_state()

### Community 47 - "Plugin Manager Tests"
Cohesion: 0.39
Nodes (5): PluginHealth, test_health_probe_failure_is_isolated_and_reported_safely(), test_health_uses_live_plugin_report_after_successful_start(), test_plugin_start_failure_does_not_stop_healthy_plugin(), TestPlugin

### Community 48 - "Dashboard Component Tests"
Cohesion: 0.22
Nodes (6): ambiguousServiceState, loadedPlan, loadedServiceState, midi, ServiceLoadState, ServicePlan

### Community 49 - "Action Dispatcher Contract"
Cohesion: 0.29
Nodes (5): ActionDispatcher, ActionName, Protocol, Shared contracts for dispatching StagePilot domain actions., Narrow action boundary used by input integrations such as MIDI.

### Community 50 - "Frontend Package Scripts"
Cohesion: 0.29
Nodes (7): scripts, build, dev, lint, preview, test, typecheck

### Community 52 - "FastAPI Request Dependencies"
Cohesion: 0.40
Nodes (3): date, Request, Response

### Community 53 - "WebSocket State Stream"
Cohesion: 0.50
Nodes (3): Live full-state WebSocket stream., state_stream(), WebSocket

### Community 54 - "Structured Logging"
Cohesion: 0.67
Nodes (3): configure_logging(), Structured application logging configuration., Configure stdlib and structlog to emit machine-readable JSON lines.

## Knowledge Gaps
- **114 isolated node(s):** `stagepilot`, `name`, `version`, `private`, `description` (+109 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **29 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlanningCenterSettings` connect `Planning Center Settings` to `Event Bus Internals`, `Planning Center Transport`, `Environment Configuration`, `MIDI Backend Interface`, `Runtime Configuration Models`, `Plan Discovery Tests`, `Planning Center Client`, `Domain Action Enums`, `MIDI Selection API`, `MIDI Port Test Doubles`, `Event Bus API`, `Application Factory Wiring`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Why does `ProPresenterSettings` connect `ProPresenter Settings` to `Environment Configuration`, `Application Entry Testing`, `Runtime Configuration Models`, `API Route Handlers`, `ProPresenter Client Contract`, `Demo Integration Settings`, `Domain Action Enums`, `ProPresenter Data Models`, `ProPresenter Output Plugin`, `Event Bus API`, `ProPresenter Controller`, `ProPresenter API Tests`, `ProPresenter HTTP Client`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `PlanningCenterClient` connect `Planning Center Client` to `Event Bus Internals`, `Planning Center Transport`, `Plan Discovery Tests`, `Planning Center Models`, `Paginated API Requests`, `Service Type Discovery`, `Plan Loading Client`, `Planning Center Settings`?**
  _High betweenness centrality (0.066) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `EventBus` (e.g. with `EventType` and `StagePilotEvent`) actually correct?**
  _`EventBus` has 35 INFERRED edges - model-reasoned connections that need verification._
- **Are the 42 inferred relationships involving `PlanningCenterClient` (e.g. with `PlanningCenterSettings` and `PlanningCenterApiError`) actually correct?**
  _`PlanningCenterClient` has 42 INFERRED edges - model-reasoned connections that need verification._
- **Are the 23 inferred relationships involving `StateService` (e.g. with `Runtime` and `create_app()`) actually correct?**
  _`StateService` has 23 INFERRED edges - model-reasoned connections that need verification._
- **Are the 53 inferred relationships involving `new_event()` (e.g. with `select_planning_center_plan()` and `._set_health()`) actually correct?**
  _`new_event()` has 53 INFERRED edges - model-reasoned connections that need verification._