# StagePilot roadmap

This roadmap describes intended scope, not a promise of dates. A milestone is
complete only when its behavior is implemented, documented, and verified; a
scaffold or mock alone does not prove a production integration.

## v0.1 — Foundation

- Monorepo structure and repeatable development setup
- FastAPI startup, health endpoint, and graceful shutdown
- Typed asynchronous event bus with subscriber failure isolation
- Central application state and safe service navigation
- Plugin lifecycle and manager
- Structured logging and recent activity
- REST and WebSocket state delivery
- React/TypeScript dark dashboard
- Demo service and events requiring no external credentials
- Minimal Tauri v2 development shell
- Event bus and state-model tests, plus API/WebSocket smoke tests

## v0.2 — Planning Center

- Secure Personal Access Token configuration
- Service type discovery and selection
- Today-first plan discovery with nearest-upcoming fallback
- Explicit handling for multiple matching plans
- Ordered linked and generic song extraction
- Scheduled duration extraction and warnings
- Manual reload and last-known-good plan behavior
- Mocked authentication, timeout, ambiguity, and parsing tests

## v0.3 — MIDI Playback

- MIDI input discovery and selection
- Configurable channel and note mappings
- Start, restart, previous, next, reload, and stop actions
- Manual cue simulation through the same event path
- Duplicate cue protection and reconnect behavior
- MIDI parsing and navigation tests

## v0.4 — ProPresenter

- Configurable host, port, timer name, timeout, and retry policy
- Connectivity checks and timer discovery
- Safe timer identifier cache and refresh
- Stop, duration update, reset, and start sequence
- Stop action, transient failure handling, and restart recovery
- Mock transport and sequence tests

## v0.5 — Persistent Setup + Planning Center Onboarding

- Validated atomic settings in `%APPDATA%\StagePilot\settings.json`
- Planning Center PAT secret storage in Windows Credential Manager
- Service-type discovery, plan preferences, and explicit ambiguous selection
- Last-known-good service cache with stale and expiration handling
- Persistent general, MIDI, and ProPresenter dashboard configuration
- Guided first-launch setup and production connection readiness
- Real integration activation without demo choices in production panels

## v0.6 — Windows Desktop Packaging + Backend Supervision

- Package and supervise the Python backend from the Tauri application
- Coordinated startup, readiness, shutdown, and port-conflict handling
- Windows NSIS installer and CI artifact

## v0.7 — Production Hardening

- Searchable rotating logs and diagnostic readiness details
- Recovery and soak testing for Sunday production use
- Explicit remote-access controls and security review

## v1.0 — Production MVP

- Verified Planning Center → MIDI → ProPresenter workflow
- Setup and readiness checks
- Persistent validated settings and platform credential storage
- Searchable live and rotating file logs with secret redaction
- Backend supervision and clean shutdown in the desktop application
- Port-conflict handling and explicit remote-access controls
- macOS signing, packaging, installer, and release documentation
- Recovery, soak, and end-to-end tests where practical

## Future versions

- Companion, WLED, OBS, NDI, MQTT, webhook, ATEM, OSC, and DMX plugins
- Stream Deck and Home Assistant integration
- Remote stage dashboard and authenticated LAN access
- Multi-campus operation, multiple timers, and service history
- Service statistics and diagnostics exports
- Native Playback integration if a supported interface becomes available
