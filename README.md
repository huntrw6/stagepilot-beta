# StagePilot

StagePilot brings the moving parts of a live production into one dependable dashboard. It loads service plans from Planning Center, listens for MIDI cues from MultiTracks Playback, keeps a ProPresenter countdown in sync, and sends scheduled MIDI cues to a lighting controller such as Lightkey.

The result is a clear view of what is playing, what comes next, how much time remains, and whether every connection is ready.

## Download

Download StagePilot from the [latest release](https://github.com/huntrw6/stagepilot/releases/latest):

- **Windows:** Run the `.exe` installer, then open StagePilot from the Start menu.
- **Apple Silicon Mac:** Open the `aarch64.dmg` disk image and drag StagePilot to Applications.
- **Intel Mac:** Open the `x64.dmg` disk image and drag StagePilot to Applications.

StagePilot v0.9.7 is the first public release. Windows or macOS may display a security warning because the application is not yet code-signed or notarized. Confirm that the download came from the official StagePilot release page before continuing.

## What you need

StagePilot can use:

- A Planning Center Services Personal Access Token
- A MIDI input from MultiTracks Playback
- ProPresenter with network control enabled
- An optional MIDI output routed to Lightkey or another lighting application

You can configure each connection from inside StagePilot. No PowerShell commands or environment variables are required.

## First launch

StagePilot opens with a setup checklist that guides you through the required connections:

1. Choose your timezone and general settings.
2. Enter your Planning Center Application ID and Secret, test the connection, and select a service type.
3. Select the MIDI input used by Playback and confirm the channel and cue note.
4. Enter the ProPresenter address and select the countdown timer.
5. Optionally select the MIDI output used for lighting cues.
6. Run the connection checks and close the checklist when everything is ready.

Settings are saved automatically for future launches. The Planning Center secret is stored securely in the operating system's credential store and is never written to the normal settings file.

## Using StagePilot

At the beginning of a production:

1. Open StagePilot and review the **Readiness check**.
2. Confirm that the correct service plan and service time are loaded.
3. Click any connection card at the top of the dashboard to review or change its configuration.
4. Send a Playback cue or use **Manual Controls** to confirm the timer workflow before the event begins.
5. Keep the dashboard open during the service to monitor the current song, remaining time, upcoming items, connection health, and recent events.

When a start cue arrives, StagePilot starts the selected song countdown and updates ProPresenter. Stop, restart, navigation, and reset cues follow the MIDI mappings shown in the MIDI configuration panel. **Reset Position** returns StagePilot and the configured ProPresenter timer to `0:00`.

The service plan includes songs, headers, and reference items in Planning Center order. Only songs are controlled by the timer workflow; the remaining items are displayed so the production team can see what is coming next.

## Lighting cues

Each song can have its own elapsed-time lighting cue map. Add a cue at the desired song position, choose its MIDI note and velocity, and StagePilot will send a short Note On/Note Off pulse through the selected Lights output while the song runs.

For a two-computer Lightkey setup, route a network MIDI session between the StagePilot computer and the Lightkey computer, then select that MIDI destination in **Lighting Configuration**. See the [lighting setup guide](docs/lights.md) for connection details.

## Reliability and recovery

StagePilot saves the last successfully loaded service plan. If Planning Center is temporarily unavailable, the cached plan remains visible with a stale-data warning so a short outage does not leave the dashboard empty.

Before relying on StagePilot in a live service, test the complete signal path with the same computers, network, MIDI routes, Playback session, ProPresenter timer, and lighting setup that will be used during the event. Manual controls remain available if an incoming cue needs to be repeated or corrected.

## Help and feedback

If something is not working, first open the relevant connection card and review its status, then check the **Recent Event Stream** for a clear error message. You can report bugs or request improvements through [GitHub Issues](https://github.com/huntrw6/stagepilot/issues).

More detailed setup information is available in the [configuration guide](docs/configuration.md), [ProPresenter guide](docs/propresenter.md), and [security notes](docs/security.md).

## MultiTracks setlist cue utility

The repository also includes [`stagepilot-cues`](tools/multitracks-cues/README.md), a standalone command-line utility that connects directly to the official MultiTracks MCP server. It can inspect a selected Playback setlist, dry-run the exact StagePilot Start-next MIDI additions, apply them only after explicit confirmation, and verify every created event by reading it back. It requires no ChatGPT, OpenAI API key, Claude, or AI model.

## Contributing

StagePilot is open source and contributions are welcome. Developers can find the local setup, testing, and packaging workflow in [CONTRIBUTING.md](CONTRIBUTING.md) and the project direction in [ROADMAP.md](ROADMAP.md).

## License

StagePilot is licensed under the [GNU General Public License v3.0](LICENSE).
