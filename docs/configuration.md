# Configuration

StagePilot starts with safe development defaults and validates configuration in
the backend. Ordinary settings persist as JSON, while the Planning Center PAT
secret is stored separately by the operating system. Environment variables
remain available for development and deployment overrides.

## Precedence

The active configuration order, from lowest to highest priority, is:

1. Application defaults committed with the backend.
2. `%APPDATA%\StagePilot\settings.json` on Windows.
3. Environment variables supplied by the process host.
4. Temporary validated changes supplied for the current process session.

The settings file is versioned, validated on read, and atomically replaced on
write. A corrupt or invalid file is left untouched and StagePilot starts from
safe defaults with a warning. `STAGEPILOT_SETTINGS_PATH` may point development
and test processes at a different file.

`GET /api/v1/settings` returns ordinary settings and whether a Planning Center
secret has been saved. `PUT /api/v1/settings` validates and persists ordinary
settings. It never accepts or returns the PAT secret. Settings that affect
plugin registration currently take effect after the backend restarts.

## General variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `STAGEPILOT_HOST` | `127.0.0.1` | API bind address. Keep loopback-only by default. |
| `STAGEPILOT_PORT` | `8765` | Local FastAPI port, from 1 through 65535. |
| `STAGEPILOT_LOG_LEVEL` | `INFO` | Backend structured-log threshold. |
| `STAGEPILOT_SERVICE_SOURCE` | `demo` | `demo` or `planning_center`. |
| `STAGEPILOT_MIDI_SOURCE` | `simulated` | `simulated` or `real`. |
| `STAGEPILOT_TIMER_OUTPUT` | `simulated` | `simulated` or `propresenter`. |
| `STAGEPILOT_TIMEZONE` | `America/Los_Angeles` | IANA time zone used for local-date plan selection. |

The older `STAGEPILOT_DEMO_MODE`, `STAGEPILOT_DEMO_SIMULATE_MIDI`, and
`STAGEPILOT_DEMO_SIMULATE_PROPRESENTER` variables remain compatible during the
v0.5 migration. Prefer the three independent mode variables for new setups.

The backend reads variables from its process environment. It does not implicitly
load a root `.env` file. Copy `.env.example` to an ignored `.env`, then use a
trusted environment manager or export the variables before launching StagePilot.

PowerShell example:

```powershell
$env:STAGEPILOT_LOG_LEVEL = "DEBUG"
uv run --project backend stagepilot
```

POSIX shell example:

```sh
STAGEPILOT_LOG_LEVEL=DEBUG uv run --project backend stagepilot
```

## Planning Center variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `STAGEPILOT_PCO_APP_ID` | unset | Personal Access Token client ID. Treated as a server-side secret. |
| `STAGEPILOT_PCO_SECRET` | unset | Personal Access Token secret. Treated as a server-side secret. |
| `STAGEPILOT_PCO_SERVICE_TYPE_ID` | unset | Service type selected for Planning Center plan loading. |
| `STAGEPILOT_PCO_PLAN_TITLE` | unset | Optional title preference used to resolve otherwise plausible plan matches. |
| `STAGEPILOT_PCO_SERVICE_TIME` | unset | Optional preferred local service time in 24-hour `HH:MM` form. |
| `STAGEPILOT_PCO_LOOKAHEAD_DAYS` | `30` | Future local dates searched when today has no match; accepts 0 through 365. |
| `STAGEPILOT_PCO_TIMEOUT_SECONDS` | `10` | HTTP request timeout, from 1 through 60 seconds. |
| `STAGEPILOT_PCO_USER_AGENT` | StagePilot project URL | Required identifying header sent to Planning Center. |

The application ID may be saved in ordinary settings. The PAT secret is stored
under the `StagePilot` service in Windows Credential Manager through Python's
`keyring` package. An incomplete credential set is valid while onboarding is in
progress, but Planning Center will not connect until both values are present.
The secret remains absent from the settings file, public application state,
URLs, logs, API responses, and outward-facing credential-backend errors.

`POST /api/v1/planning-center/settings` saves the non-secret Planning Center
fields and can replace or remove the credential-store secret. `GET
/api/v1/planning-center/status` returns only a boolean saved-secret state plus
the public setup fields. The typed client can discover service types,
prefer plans with service times on today's configured local date, fall back to
the nearest upcoming service date within the lookahead window, surface
same-date ambiguous matches, and parse a selected plan's ordered songs. Past
plans, plans without service times, and plans containing only non-service times
are not eligible. Demo mode remains the safe default. When demo mode is
disabled, StagePilot registers only the production Planning Center plugin,
loads the configured service type at startup, and handles dashboard reload and
plan-selection requests.

`STAGEPILOT_PCO_LOOKAHEAD_DAYS` defaults to `30`; set it to `0` to disable the
fallback. The fallback runs only when
today has no qualifying plan; a plan today always wins over every future plan.
If several plans share the nearest upcoming service date, StagePilot asks the
operator to choose among those plans and does not offer plans on later dates. A
not-found result means no eligible service plan exists today or within the
configured future window.

For a local production-integration smoke test, set all required values in the
launching process. Do not paste real values into tracked files:

```powershell
$env:STAGEPILOT_SERVICE_SOURCE = "planning_center"
$env:STAGEPILOT_TIMEZONE = "America/Los_Angeles"
$env:STAGEPILOT_PCO_APP_ID = "<your application id>"
$env:STAGEPILOT_PCO_SECRET = "<your secret>"
$env:STAGEPILOT_PCO_SERVICE_TYPE_ID = "<your service type id>"
$env:STAGEPILOT_PCO_LOOKAHEAD_DAYS = "30"
uv run --project backend stagepilot
```

An unsuccessful refresh leaves the last valid current or upcoming plan in
memory and marks it stale. A preloaded upcoming plan remains available as local
calendar days advance toward it. Once its service date has passed, it is cleared
and its running timer is stopped and reset rather than remaining actionable.
Not-found and ambiguous outcomes keep Planning Center connected; the dashboard
displays them as plan-readiness states and allows explicit selection when
several plans share the selected service date.

Planning Center documents Personal Access Tokens as appropriate for local tools
used with one organization. A future multi-organization StagePilot distribution
must use OAuth instead of collecting PAT credentials. See Planning Center's
[authentication documentation](https://api.planningcenteronline.com/docs/overview/authentication).

## MIDI Playback variables

Real Playback MIDI is disabled by default. Select it independently with
`STAGEPILOT_MIDI_SOURCE=real`. MIDI uses an operating-system input port and
needs no client ID, API key, password, or other secret.

| Variable | Default | Purpose |
| --- | --- | --- |
| `STAGEPILOT_MIDI_SOURCE` | `simulated` | Set to `real` to register the MIDI Playback plugin. |
| `STAGEPILOT_MIDI_INPUT_NAME` | unset | Exact, unique startup input-port name. An unset name starts disconnected and still allows discovery. |
| `STAGEPILOT_MIDI_CHANNEL` | `1` | One-based MIDI channel to accept, from 1 through 16. |
| `STAGEPILOT_MIDI_NOTE` | `112` (E7 in Playback) | Fixed note accepted for all StagePilot cues. |
| `STAGEPILOT_MIDI_START_NEXT_VELOCITY` | `100` | Starts the next song and its timer. |
| `STAGEPILOT_MIDI_RESTART_CURRENT_VELOCITY` | `101` | Restarts the current song and timer. |
| `STAGEPILOT_MIDI_PREVIOUS_VELOCITY` | `102` | Selects the previous song. |
| `STAGEPILOT_MIDI_NEXT_VELOCITY` | `103` | Selects the next song. |
| `STAGEPILOT_MIDI_RELOAD_PLAN_VELOCITY` | `104` | Requests a Planning Center plan reload. |
| `STAGEPILOT_MIDI_STOP_TIMER_VELOCITY` | `105` | Stops the active timer. |
| `STAGEPILOT_MIDI_DEBOUNCE_MS` | `250` | Duplicate note-on suppression window, from 0 through 2000 milliseconds. |

Mapped velocities must be distinct integers from 1 through 127. A qualifying
note-on must use the configured note and channel and have a mapped velocity;
note-off, including note-on with velocity zero, releases the held-note latch.

`STAGEPILOT_MIDI_INPUT_NAME` is the startup default. The dashboard may override
it for the current backend session without changing the environment. Keep your
existing Planning Center variables in the same PowerShell session when using
production mode, then launch with MIDI enabled. Leave the startup input unset to
begin disconnected and discover available ports:

```powershell
$env:STAGEPILOT_MIDI_SOURCE = "real"
$env:STAGEPILOT_MIDI_CHANNEL = "1"
Remove-Item Env:STAGEPILOT_MIDI_INPUT_NAME -ErrorAction SilentlyContinue
uv run --project backend stagepilot
```

The dashboard includes a MIDI setup panel. Use **Refresh inputs** to
enumerate ports, choose an available input to connect, or choose the disconnect
option to close the current input. An accepted selection is saved to the local
settings file and reused on the next launch unless an environment override is
present.

The REST API exposes the same flow. In another PowerShell window, refresh the
input list and inspect the returned opaque IDs:

```powershell
$inputs = Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8765/api/v1/midi/inputs/refresh"
$inputs | ConvertTo-Json -Depth 5
```

Select one returned input by its `id`. Treat the ID as opaque; do not construct
it from the port name:

```powershell
$body = @{ input_id = "<opaque id from refresh>" } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8765/api/v1/midi/input-selection" `
  -ContentType "application/json" `
  -Body $body
```

Send `null` to disconnect without stopping the backend:

```powershell
$body = @{ input_id = $null } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8765/api/v1/midi/input-selection" `
  -ContentType "application/json" `
  -Body $body
```

Environment variables are read when the backend starts. Stop and restart the
backend after changing the channel, note, velocity mapping, debounce, or source
mode. Dashboard and API input selections take effect immediately and persist
without requiring a restart. The plugin monitors the selected port and retries
a missing or failed input with capped backoff; a disconnected device keeps
health degraded until it reconnects.

Manual simulation accepts one of `start_next`, `restart_current`, `previous`,
`next`, `reload_plan`, or `stop_timer`. It enters the same ordered cue pipeline
and application action dispatcher as a hardware note, so it can change the
loaded song or timer state and should be treated as a real control:

```powershell
$body = @{ cue = "start_next" } | ConvertTo-Json
Invoke-RestMethod -Method Post `
  -Uri "http://127.0.0.1:8765/api/v1/midi/cue-simulation" `
  -ContentType "application/json" `
  -Body $body
```

`GET /api/v1/midi/inputs` returns the current MIDI setup snapshot. When the
plugin is disabled, discovery returns `enabled: false` with no active inputs;
input selection and cue simulation return HTTP 409. A selection request also
returns HTTP 409 if its ID is stale, unavailable, or refers to an ambiguous port
name. Simulation can exercise the cue path while an enabled plugin is
disconnected, but it does not mark the MIDI input as connected or make its
health ready.

The production dashboard also polls `GET /api/v1/midi/messages` for a bounded
live note monitor. It displays the selected input, note-on or note-off type,
one-based channel, note name and number, velocity, and whether StagePilot
dispatched or ignored the message. Wrong-channel, unmapped, duplicate, rejected,
and release messages remain visible for routing and mapping diagnosis. Note names
use Playback's octave convention, where MIDI note 0 is displayed as C-2; the MIDI
number remains the authoritative mapping value.

## Network configuration

The browser dashboard expects the backend at `http://127.0.0.1:8765` and its
WebSocket endpoint at `ws://127.0.0.1:8765/ws`. The Tauri content security policy
permits those loopback connections and Vite's local development origin.

For a different development API origin, copy `frontend/.env.example` to
`frontend/.env.local` and set `VITE_STAGEPILOT_API_URL`. Vite embeds every
`VITE_*` value into public browser assets, so this setting must never contain a
credential or other secret.

Changing `STAGEPILOT_HOST` to `0.0.0.0` or a LAN address makes the service
reachable beyond the local process boundary. Do not do this merely to solve a
CORS error. First address authentication, TLS or a trusted reverse proxy,
allowed origins, firewall policy, and exposure of state and log data. See
[security.md](security.md).

## Local files

The following patterns are ignored because they can contain secrets or
machine-specific state:

- `.env` and `.env.*` except `.env.example`
- `*.local.json`, `*.local.toml`, `*.local.yaml`, and `*.local.yml`
- `.stagepilot/`
- logs and process identifiers

Exported configuration should omit credentials by default. A future diagnostic
bundle must use explicit allow-lists and redaction rather than serializing the
complete settings object.

## ProPresenter recovery settings

The ProPresenter plugin reconnects automatically and periodically rediscovers the configured timer.

```dotenv
STAGEPILOT_PROPRESENTER_RECONNECT_INITIAL_SECONDS=1
STAGEPILOT_PROPRESENTER_RECONNECT_MAX_SECONDS=30
STAGEPILOT_PROPRESENTER_HEALTH_CHECK_SECONDS=10
```

The dashboard can change host, port, timer name, and request timeout. Accepted
values are persisted to the local settings file and reused after restart.

