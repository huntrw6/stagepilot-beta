# MultiTracks Playback cue automation

StagePilot includes an independent TypeScript package at `tools/multitracks-cues`. It is an MCP client—not an MCP server—and has no dependency on the StagePilot Python backend, desktop shell, ChatGPT, OpenAI, Claude, or any AI model.

The utility connects to the official MultiTracks Streamable HTTP endpoint, validates live `tools/list` input schemas, and maps the canonical StagePilot Start-next cue into the exact schema only when song-start semantics can be proven. Library MIDI and explicit Cloud Arrangement MIDI targets are handled separately. Ambiguous classification, duplicate banks, malformed events, near-start cues, alternate velocities, and cues in another bank or bus are reported rather than changed.

Its safety sequence is:

```text
fresh setlist + bus + bank + event inspection
                  ↓
        deterministic dry-run plan
                  ↓
       explicit apply confirmation
                  ↓
       one sequential create call
                  ↓
    complete scoped event read-back
                  ↓
 canonical verification + journal/report
```

Library targets are deduplicated by stable library entry ID. Cloud arrangements remain distinct by arrangement ID. The utility never copies, replaces, imports, uploads, modifies, or deletes MIDI data.

See the [package guide](../tools/multitracks-cues/README.md) for installation and commands and [client registration](multitracks-client-registration.md) for the current external OAuth requirement.

## Future desktop integration

The public package boundary exports reusable connection, authentication, discovery, inspection, planning, apply, and verification services. A future StagePilot desktop panel can call the compiled package or supervise it as a sidecar. The current standalone tool intentionally does not import the StagePilot backend or alter the released desktop UI.
