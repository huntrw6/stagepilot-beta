# StagePilot MultiTracks Cues

`stagepilot-cues` is a standalone command-line application that connects directly to the official MultiTracks MCP server. It safely adds one cue—the StagePilot **Start next** note—to the beginning of selected Playback setlist songs.

It does not use ChatGPT, OpenAI, Claude, an AI model, another MCP host, AppleScript, or Playback UI automation. A qualifying MultiTracks One or Live Bundle subscription and a MultiTracks-issued standalone OAuth client ID may still be required.

## MIDI cue

- Channel: `1`
- Note: `112` (`E7`)
- Velocity: `100`
- Position: exact song start reported by the MCP schema
- Bank: `StagePilot`
- Bus: an explicitly selected, dedicated MIDI bus

No other StagePilot actions are created.

## Install on macOS

Install the current Node.js 22 or 24 LTS release, clone StagePilot, and run:

```sh
npm --prefix tools/multitracks-cues ci
npm --prefix tools/multitracks-cues run build
npm --prefix tools/multitracks-cues run local-install
```

`npm link` makes `stagepilot-cues` available in Terminal for the current Node installation. A package-local alternative, which does not create a global link, is:

```sh
npm --prefix tools/multitracks-cues run dev -- doctor
```

## Windows development

Use Node.js 22 or 24 and the same `npm ci`, `typecheck`, `test`, `lint`, and `build` commands from PowerShell. Tokens are stored in Windows Credential Manager; macOS uses Keychain.

## OAuth client registration

MultiTracks currently advertises PKCE authorization and refresh tokens but does not advertise dynamic client registration. Request a legitimate standalone client ID using [the registration guide](../../docs/multitracks-client-registration.md), then configure it:

```sh
stagepilot-cues configure
stagepilot-cues auth login
stagepilot-cues auth status
```

The client ID is ordinary configuration. If MultiTracks issues a client secret, enter it through `configure`; the hidden value is stored in the OS credential store. Never use ChatGPT or Claude credentials.

## Safe workflow

Start with the read-only doctor:

```sh
stagepilot-cues doctor
stagepilot-cues tools --output multitracks-tools.sanitized.json
stagepilot-cues setlists list --from 2026-07-01 --to 2026-08-01
stagepilot-cues configure
```

Select a dedicated, unused Aux bus by its exact stable ID. The utility refuses to automatically select a bus and rejects obvious Lyrics, Lights, Patches, or Guitar buses.

Inspect and prepare a setlist; both commands are read-only:

```sh
stagepilot-cues setlists inspect --setlist-id SETLIST_ID
stagepilot-cues prepare --setlist-id SETLIST_ID
```

Apply to one test song first, using its displayed setlist position:

```sh
stagepilot-cues apply --setlist-id SETLIST_ID --song-position 3
stagepilot-cues verify --setlist-id SETLIST_ID --song-position 3
```

Refresh or reopen the setlist in Playback. Confirm that Playback sends channel 1, note 112/E7, velocity 100 and that StagePilot receives **Start next**. Only then apply the remaining songs:

```sh
stagepilot-cues apply --setlist-id SETLIST_ID
stagepilot-cues verify --setlist-id SETLIST_ID
```

Apply always performs a fresh inspection and requires typing `APPLY SETLIST_ID`, unless the explicit automation option `--yes` is supplied. Dry-run is the default everywhere else.

## Reports and recovery

Inspect, prepare, apply, and verify write timestamped text, JSON, and CSV reports. Apply also keeps an atomic operation journal. If the process is interrupted, run the same apply command again: verified cues are detected and skipped, uncertain creates are reconciled by reading remote state, and no delete or overwrite is attempted.

## Security

OAuth access and refresh tokens are stored only in macOS Keychain, Windows Credential Manager, or a supported Linux Secret Service. The utility fails closed when no secure backend exists. Tokens, secrets, authorization codes, PKCE verifiers, cookies, and complete OAuth responses are redacted from output and reports.

The MCP client has a fixed allowlist. Only three create tools can run in apply mode. Bank/event delete, bank copy, production-cue import, and MIDI-file upload tools are blocked in code.

Logout revokes tokens when the authorization server advertises revocation, then removes local tokens and organization identity:

```sh
stagepilot-cues auth logout
```

## Troubleshooting

- **OAuth client registration required:** send the support request in the registration guide to MultiTracks.
- **Saved MIDI bus is missing:** run `configure` and select an exact current bus ID.
- **Ambiguous song target:** confirm that the setlist item exposes an explicit Library or Cloud Arrangement identity; the utility will not infer it from a title.
- **Conflict reported:** inspect Playback/MultiTracks MIDI data manually. This task never edits or deletes an existing event.
- **Schema unsupported:** save sanitized schemas with `tools --output` and report the incompatibility; do not guess field names or song-start values.
- **Credential store unavailable:** unlock Keychain/Credential Manager and rerun `doctor`. Plaintext fallback is never enabled automatically.

## Unattended operation

`sync-next` is dry-run by default and refuses multiple plausible setlists. It needs a previously confirmed organization, selected bus, exact setlist-name filter where appropriate, and a renewable refresh token. It never opens a browser on an unattended run.

An example macOS LaunchAgent is provided at `examples/org.stagepilot.multitracks-cues.plist`. It runs `sync-next` without `--apply`. Copy and customize it manually only after the interactive workflow succeeds. Do not add `--apply --yes` until repeated dry-runs and a one-song live test have been reviewed.

## Developer checks

```sh
npm --prefix tools/multitracks-cues run typecheck
npm --prefix tools/multitracks-cues test -- --run
npm --prefix tools/multitracks-cues run lint
npm --prefix tools/multitracks-cues run build
```

The package exports reusable `connect`, `authenticate`, `listTools`, `listSetlists`, `getSetlist`, `listMidiBuses`, `inspectSetlist`, `buildCuePlan`, `applyCuePlan`, and `verifyCuePlan` services for a future StagePilot desktop panel or sidecar.
