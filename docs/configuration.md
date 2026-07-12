# Configuration

StagePilot starts with safe development defaults and validates configuration in
the backend. Milestone 1 supports environment overrides for the local server and
demo mode. Persistent settings and operating-system credential storage are
planned work and should not be treated as implemented.

## Precedence

The intended configuration order, from lowest to highest priority, is:

1. Application defaults committed with the backend.
2. An ignored local configuration file.
3. Environment variables supplied by the process host.
4. Validated runtime settings saved through the application.

Only defaults and the documented environment variables are active in Milestone
1. Later layers must preserve the same typed validation and secret-redaction
rules when implemented.

## Milestone 1 variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `STAGEPILOT_HOST` | `127.0.0.1` | API bind address. Keep loopback-only by default. |
| `STAGEPILOT_PORT` | `8765` | Local FastAPI port, from 1 through 65535. |
| `STAGEPILOT_LOG_LEVEL` | `INFO` | Backend structured-log threshold. |
| `STAGEPILOT_DEMO_MODE` | `true` | Enables data and behavior that require no vendor connections. |

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

The following names are reserved for the v0.2 Planning Center work and are
commented out in `.env.example`:

- `STAGEPILOT_PCO_APP_ID`
- `STAGEPILOT_PCO_SECRET`
- `STAGEPILOT_PCO_SERVICE_TYPE_ID`
- `STAGEPILOT_TIMEZONE`

Milestone 1 does not consume or validate them. Do not infer a working Planning
Center connection from their presence. When implemented, the secret must use a
secret input model, remain absent from public state, and be redacted from logs.

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
