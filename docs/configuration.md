# Configuration

StagePilot starts with safe development defaults and validates configuration in
the backend. Environment overrides now cover the local server, demo mode, time
zone, and the initial Planning Center Personal Access Token client. Persistent
settings and operating-system credential storage remain planned work and should
not be treated as implemented.

## Precedence

The intended configuration order, from lowest to highest priority, is:

1. Application defaults committed with the backend.
2. An ignored local configuration file.
3. Environment variables supplied by the process host.
4. Validated runtime settings saved through the application.

Only defaults and the documented environment variables are active today. Later
layers must preserve the same typed validation and secret-redaction rules when
implemented.

## General variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `STAGEPILOT_HOST` | `127.0.0.1` | API bind address. Keep loopback-only by default. |
| `STAGEPILOT_PORT` | `8765` | Local FastAPI port, from 1 through 65535. |
| `STAGEPILOT_LOG_LEVEL` | `INFO` | Backend structured-log threshold. |
| `STAGEPILOT_DEMO_MODE` | `true` | Enables data and behavior that require no vendor connections. |
| `STAGEPILOT_TIMEZONE` | `America/Los_Angeles` | IANA time zone used for local-date plan selection. |

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
| `STAGEPILOT_PCO_SERVICE_TYPE_ID` | unset | Service type selected for future plan loading. |
| `STAGEPILOT_PCO_TIMEOUT_SECONDS` | `10` | HTTP request timeout, from 1 through 60 seconds. |
| `STAGEPILOT_PCO_USER_AGENT` | StagePilot project URL | Required identifying header sent to Planning Center. |

The application ID and secret must be provided together. They use Pydantic
secret types, remain absent from public application state, and are never placed
in URLs or outward-facing errors. The initial typed client can discover service
types, but the production Planning Center plugin and plan loading are not wired
into application startup yet. Demo mode therefore remains the default.

Planning Center documents Personal Access Tokens as appropriate for local tools
used with one organization. A future multi-organization StagePilot distribution
must use OAuth instead of collecting PAT credentials. See Planning Center's
[authentication documentation](https://api.planningcenteronline.com/docs/overview/authentication).

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
