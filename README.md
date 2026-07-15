# StagePilot

StagePilot is an open-source church production automation platform. Its first
workflow connects Planning Center Services, MultiTracks Playback MIDI cues,
a reusable ProPresenter countdown timer, and timed lighting MIDI output. The longer-term goal is a reliable,
event-driven automation hub for live production systems.

> [!IMPORTANT]
> StagePilot is in early development. The foundation and initial Planning Center
> plan-loading workflow are implemented, and the first backend MIDI Playback
> slice is available for development testing. The application is not ready to
> run a live service or control production equipment.

## What the first workflow will do

1. Load today's ordered songs and scheduled durations from Planning Center, or
   the nearest upcoming service when today has no plan.
2. Translate configured MIDI cues from Playback into typed StagePilot events.
3. Select or restart the appropriate song without blind index changes.
4. Stop, set, reset, and start one reusable ProPresenter timer.
5. Run per-song elapsed-time MIDI cue maps for Lightkey-compatible lighting automation.
6. Publish state, health, and recent activity to the local dashboard.

Integrations communicate through the backend event bus rather than calling one
another directly. The backend can run without Tauri so a browser, headless host,
or future remote dashboard can use the same API.

## Repository layout

```text
backend/       FastAPI service, event bus, state, plugins, and Python tests
frontend/      React, TypeScript, Vite, and Tailwind dashboard
desktop/       Minimal Tauri v2 native shell
docs/          Configuration, security, and plugin development notes
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries and decisions.

## Screenshots

Screenshots will be added as the dashboard stabilizes. The current interface is
intended for development and demo-mode validation.

## Prerequisites

- Python 3.12 or newer and [uv](https://docs.astral.sh/uv/)
- A current Node.js LTS release and npm
- Rust stable plus the
  [Tauri v2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)
  when running the desktop shell

No Planning Center, MIDI, or ProPresenter credentials are required for demo
development. MIDI itself never requires an API key or secret; it uses a local
input port exposed by the operating system.

## Development setup

Clone the repository, then install each workspace's dependencies:

```sh
uv sync --project backend --extra dev
cd frontend
npm install
cd ../desktop
npm install
cd ..
```

Copy `.env.example` to `.env` only when local overrides are needed. Keep the
copy untracked and never put real credentials in `.env.example`.

### Run the backend

```sh
uv run --project backend uvicorn stagepilot.main:app --reload --host 127.0.0.1 --port 8765
```

The backend is intentionally bound to loopback. Check it at
`http://127.0.0.1:8765/api/v1/health`.

### Configure MIDI Playback

MIDI input is disabled by default. Open the dashboard's **MIDI / Playback**
connection panel, review the channel, fixed note, action velocities, and
debounce, then save. When the MIDI plugin is already running, these cue-filter
changes apply immediately. Saving automatically enables real MIDI; enabling the
plugin for the first time still requires a restart. The dashboard can then
refresh, select, and disconnect an input.
The same flow is available through `POST /api/v1/midi/inputs/refresh` and
`POST /api/v1/midi/input-selection`. Accepted selections persist in
`%APPDATA%\StagePilot\settings.json`. The cue-simulation endpoint exercises a
named cue through the same application-action path as hardware input.
Changes that create or remove an integration take effect after restart.
Environment variables remain available as higher-priority development
overrides. See
[docs/configuration.md](docs/configuration.md#midi-playback-variables) for the
six default note mappings, endpoint examples, and validation limits.

### Configure Lights

Open the dashboard's **Lights** connection panel, select the MIDI output routed
to the Lightkey Mac, and save the channel and Note On/Off pulse length. Each
loaded Planning Center song has a persistent elapsed-time cue map with a
`mm:ss` position, MIDI note, velocity, and label. See
[docs/lights.md](docs/lights.md) for the two-Mac network MIDI setup and test flow.

### Run the browser dashboard

In another terminal:

```sh
npm --prefix frontend run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173`.

### Run the Tauri desktop shell

Keep the backend running, then use:

```sh
npm --prefix desktop run dev
```

Tauri starts the Vite development server and opens it in a native window. The
Milestone 1 shell does not yet package or supervise the Python backend; that is a
later packaging milestone.

## Quality checks

```sh
# Backend tests, lint, and formatting check
cd backend
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy
cd ..

# Frontend checks and production build
npm --prefix frontend run lint
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build

# Rust shell check
cargo check --manifest-path desktop/src-tauri/Cargo.toml
```

Apply backend and Rust formatting with:

```sh
cd backend && uv run ruff format .
cargo fmt --manifest-path desktop/src-tauri/Cargo.toml
```

Script names are defined by each workspace manifest. See
[CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## Build artifacts

Build the browser assets on their own with `npm --prefix frontend run build`.
Build the native release executable with:

```sh
npm --prefix desktop run build
```

The desktop command builds the frontend first. Tauri installer bundling is
deliberately disabled in Milestone 1; signing, installers, and Python backend
sidecar packaging remain v1.0 work.

## Configuration and security

Configuration layers defaults, `%APPDATA%\StagePilot\settings.json`,
environment-variable overrides, and validated session changes. Planning Center
PAT secrets live in Windows Credential Manager and are never returned through
frontend API responses. Remote access is disabled by binding to `127.0.0.1` by
default.

Read [docs/configuration.md](docs/configuration.md) and
[docs/security.md](docs/security.md) before adding credentials or enabling LAN
access. Use [docs/v0.5-acceptance.md](docs/v0.5-acceptance.md) for the final
Windows production sign-off.

## Project status

Milestone 1 foundation work is complete. The current v0.5 work includes
validated, secret-aware PAT configuration, service-type discovery, and a typed
client that parses ordered songs and discovers today's plan first, then the
nearest upcoming plan within a configurable window. The window defaults to 30
days. The dashboard can test Planning Center credentials, populate the service
type dropdown, follow a first-launch readiness checklist, and persist general,
MIDI, and ProPresenter setup without PowerShell variables. Saving a production
integration enables its real backend mode automatically; demo and simulated
choices are hidden from the production panels. The Planning Center plugin handles
reloads without discarding an active last-known-good plan, and exposes ambiguous
same-date plan selection in the dashboard. Disk-backed last-known-good plan
caching and preference-aware ambiguity resolution are implemented. See
[ROADMAP.md](ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md) for scope and progress.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), keep
plugin boundaries explicit, and include tests for behavioral changes.

## License

StagePilot is licensed under the [GNU General Public License v3.0](LICENSE).
