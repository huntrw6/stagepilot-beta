# Changelog

All notable changes to StagePilot will be documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
intends to use [Semantic Versioning](https://semver.org/) once releases begin.

## [Unreleased]

## [0.9.11] - 2026-07-19

### Fixed

- Configure and reset ProPresenter timers atomically before duration verification,
  allowing repeated song cues to start reliably.
- Allow Countdown to Time and Elapsed Time timers to be selected and convert
  them to Countdown Timers when a song-start cue arrives.
- Preserve packaged backend diagnostics in the macOS application log directory.

## [0.9.10] - 2026-07-19

### Fixed

- Retry loading general settings only after the packaged backend is reachable,
  preventing a stale macOS WebKit `Load failed.` message.
- Verify ProPresenter duration changes through the documented single-timer API
  and allow slower Intel Mac updates without starting an unconfirmed timer.

## [0.9.9] - 2026-07-19

### Fixed

- Preserve completed first-launch onboarding when a stale settings snapshot is
  saved by another configuration panel.
- Verify ProPresenter countdown durations before resetting and starting timers,
  including delayed updates observed on Intel macOS.
- Terminate nested PyInstaller backend processes when StagePilot exits or
  restarts on macOS.
- Explicitly create, show, focus, and restore the StagePilot window when the app
  launches or is reopened from the macOS Dock.

### Changed

- Added macOS desktop lifecycle compilation and regression tests to CI.

## [0.9.8] - 2026-07-18

### Added

- Select and apply a saved ProPresenter Look when ProPresenter settings are saved.
- Standalone MultiTracks MCP cue utility with dry-run planning, guarded writes,
  verification, secure authentication, and reporting.

### Fixed

- Restart the managed desktop backend automatically after MIDI or Planning
  Center settings enable a previously inactive integration.
- Fully quit the managed backend with the desktop application and pass the
  saved-settings path explicitly to packaged backend processes on macOS.

## [0.9.7] - 2026-07-15

### Added

- Initial monorepo foundation for the FastAPI backend, React dashboard, and
  Tauri desktop shell.
- Typed asynchronous event bus, observable application state, isolated plugin
  manager, structured logging, and graceful application lifecycle.
- Demo service workflow with safe song navigation, timer simulation, REST
  actions, health/state APIs, and full-state WebSocket updates.
- Dark, responsive live-production dashboard with connection status, ordered
  songs, current timer state, readiness checks, manual controls, and events.
- Core, plugin, API, and WebSocket tests plus backend and frontend quality
  tooling.
- Shared architecture, contribution, configuration, security, plugin, and
  milestone documentation.
- Safe example environment configuration and repository ignore rules.
- Secret-aware Planning Center PAT configuration with validated credentials,
  IANA time zone, request timeout, and identifying user-agent settings.
- Typed asynchronous Planning Center service-type client with Basic Auth,
  version pinning, safe pagination, timeout handling, sanitized errors, and
  mocked contract tests.
- Today-first Planning Center plan discovery with timezone-aware service-time
  matching and a configurable nearest-upcoming fallback window that defaults to
  30 days. Discovery excludes past and no-service-time plans and preserves
  explicit ambiguity when multiple plans share the selected date.
- Ordered linked and generic Planning Center song parsing with scheduled
  durations, source song IDs, and visible skipped-item reasons.
- Production Planning Center plugin startup and reload orchestration with
  current-or-upcoming last-known-good plans, connection and discovery state,
  explicit dashboard plan selection, skipped-item visibility, live health,
  single-flight refreshes, date-rollover cleanup, and demo-mode isolation.
- First backend MIDI Playback slice with disabled-by-default Mido/RtMidi input
  discovery, environment-configured port, channel, and six cue mappings, bounded
  ordered dispatch, duplicate protection, reconnect handling, safe port metadata,
  session-only API and dashboard input selection, disconnect and refresh
  controls, and manual cue simulation through the hardware action path.
- Bounded live MIDI note monitor with port, channel, note, velocity, and
  accepted-or-ignored diagnostics in the production dashboard.
- Vitest and React Testing Library coverage for dashboard plan ambiguity,
  pending selection, revision-safe live state, stale readiness, and skipped-item
  warnings.
- Persistent v0.5 setup with validated atomic settings, Windows Credential
  Manager PAT storage, independent backend integration modes, service-type
  onboarding, preference-aware plan selection, and a non-secret
  last-known-good service cache.
- Six-step first-launch checklist plus editable general, advanced MIDI, and
  ProPresenter configuration. Production panels activate real integrations when
  saved and no longer expose demo or simulated choices.
- Auto-closing first-launch completion feedback with manual dismissal, plus a
  full MIDI 0–127 note-name dropdown using Playback's octave convention.
- Live MIDI cue-filter reconfiguration so saved note, channel, velocity, and
  debounce changes affect the running Playback input without a restart.
- A persistent **Lights** connection and lighting configuration panel with
  macOS MIDI-output discovery, Lightkey-compatible Note On/Off test pulses, and
  per-song elapsed-time cue maps keyed by stable Planning Center song IDs.
- A monotonic backend lighting scheduler that starts from the confirmed shared
  countdown event, cancels safely on stop/restart, and prevents old timelines
  from firing after a song change.
- Live remaining and elapsed song clocks in the dashboard, derived from the
  same timer start and scheduled duration used by ProPresenter.
- ProPresenter-aligned countdown rounding and start timestamps, plus a Reset
  Position sequence that stops the configured timer and resets its duration to
  zero in both StagePilot and ProPresenter.
- A reserved header notification queue with content-width confirmation and
  error highlights. Concurrent action and service-state messages display in
  order for up to six seconds without shifting dashboard controls.
- Planning Center non-song items interleaved into the service-plan display by
  their original sequence, with compact header separators and subdued ordinary
  items that show Planning Center descriptions and scheduled durations while
  remaining excluded from song controls.
- A bundled 1700-by-2560 film-flare application background that scrolls from
  the top without scaling, plus matching desktop maximum window dimensions.
- A simplified StagePilot header wordmark using a locally bundled Instrument
  Serif font across browser and desktop builds.
- Cohesive, higher-contrast setup panels with a shared Production setup header,
  brighter supporting text, compact connection-status badge, and restrained
  per-integration button accents.
- A darker translucent Now Playing card, a larger outlined StagePilot wordmark,
  and right-aligned header notifications beside the system status.
- Dark translucent connection-card hover states with brighter text, semantic
  manual-control button accents, and green/red event-stream severity styling.
- Outline-first manual controls that reveal their semantic colors on hover and
  press, including a green Restart Current action and dark-green Now Playing label.
- A locally bundled StagePilot header font and a two-message notification queue
  that discards older messages when newer notifications arrive.
- Dark-orange Now Playing labeling and deeper READY-green highlighting for the
  current song row, subtitle, and numbered icon.
- A reproducible PyInstaller backend sidecar, Tauri startup/readiness/port-conflict
  supervisor, owned-process-tree shutdown, NSIS release configuration, desktop
  connection-status bridge, and CI-built Windows installer artifact.

[Unreleased]: https://github.com/huntrw6/stage-pilot/compare/v0.9.9...HEAD
[0.9.9]: https://github.com/huntrw6/stage-pilot/releases/tag/v0.9.9
[0.9.8]: https://github.com/huntrw6/stage-pilot/releases/tag/v0.9.8
[0.9.7]: https://github.com/huntrw6/stage-pilot/releases/tag/v0.9.7
