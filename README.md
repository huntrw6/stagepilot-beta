# StagePilot

StagePilot is an open-source church production automation platform. Its first
workflow will connect Planning Center Services, MultiTracks Playback MIDI cues,
and a reusable ProPresenter countdown timer. The longer-term goal is a reliable,
event-driven automation hub for live production systems.

> [!IMPORTANT]
> StagePilot is in early development. The foundation is complete and Planning
> Center client work is underway, but the application is not ready to run a live
> service or control production equipment.

## What the first workflow will do

1. Load today's ordered songs and scheduled durations from Planning Center.
2. Translate configured MIDI cues from Playback into typed StagePilot events.
3. Select or restart the appropriate song without blind index changes.
4. Stop, set, reset, and start one reusable ProPresenter timer.
5. Publish state, health, and recent activity to the local dashboard.

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
development.

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

Configuration is expected to layer defaults, a local configuration file,
environment-variable overrides, and validated runtime settings. Planning Center
credentials are secrets: do not commit, log, or return them through frontend API
responses. Remote access is disabled by binding to `127.0.0.1` by default.

Read [docs/configuration.md](docs/configuration.md) and
[docs/security.md](docs/security.md) before adding credentials or enabling LAN
access.

## Project status

Milestone 1 foundation work is complete. Milestone 2 currently includes
validated, secret-aware PAT configuration and a typed, paginated service-type
client with mocked tests. Production plugin registration, plan discovery, song
extraction, and the setup interface remain in progress. See
[ROADMAP.md](ROADMAP.md) and [CHANGELOG.md](CHANGELOG.md) for scope and progress.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), keep
plugin boundaries explicit, and include tests for behavioral changes.

## License

StagePilot is licensed under the [GNU General Public License v3.0](LICENSE).
