# StagePilot

StagePilot is a desktop production dashboard for keeping a live service coordinated. It loads the current or next upcoming service plan from Planning Center, responds to MIDI cues from MultiTracks Playback, controls a ProPresenter song countdown, and sends scheduled MIDI cues to lighting software such as Lightkey.

The dashboard provides one dependable view of the service order, current song, remaining and elapsed time, upcoming items, connection readiness, and recent activity.

## Download StagePilot 1.1

Download the installer for your computer from the [StagePilot 1.1.0 release](https://github.com/huntrw6/stagepilot/releases/tag/v1.1.0):

- [Windows x64 installer](https://github.com/huntrw6/stagepilot/releases/download/v1.1.0/StagePilot_1.1.0_x64-setup.exe)
- [Intel Mac DMG](https://github.com/huntrw6/stagepilot/releases/download/v1.1.0/StagePilot_1.1.0_x64.dmg)
- [Apple Silicon Mac DMG](https://github.com/huntrw6/stagepilot/releases/download/v1.1.0/StagePilot_1.1.0_aarch64.dmg)

On Windows, run the installer and open StagePilot from the Start menu. On macOS, open the DMG and drag StagePilot into Applications.

StagePilot is not currently code-signed or notarized, so the operating system may ask you to confirm that you trust the application. Only install downloads from the official StagePilot GitHub release page.

## What you need

StagePilot works with:

- Planning Center Services and a Personal Access Token
- A MIDI input from MultiTracks Playback or another MIDI source
- ProPresenter with its local network API enabled
- Optionally, a MIDI destination for Lightkey or another lighting controller

Planning Center, MIDI, and ProPresenter are independent. You can configure and test one connection without requiring every other integration to be online.

## Initial setup

All normal setup happens inside StagePilot; command-line variables are not required.

1. Click **StagePilot backend** and set the timezone, log level, and local server port.
2. Click **Planning Center**, enter the Personal Access Token Application ID and Secret, test the connection, and choose a service type from the discovered list.
3. Click **MIDI / Playback**, select the MIDI input, channel, cue note, action velocities, and debounce time.
4. Click **ProPresenter**, enter its host and API port, select the song timer and optional Look, then test the connection.
5. Click **Lights** to select an output and add elapsed-time lighting cues when lighting automation is needed.

Settings persist between launches. Planning Center credentials are stored separately in the operating system credential store and are never returned by the StagePilot API.

## Browser dashboard

While the StagePilot desktop app is running, the same dashboard is available in a browser at [http://127.0.0.1:8765](http://127.0.0.1:8765), using the server port saved in **StagePilot backend**.

To open it from another computer on the same trusted network:

1. Open **StagePilot backend** and enable **Allow dashboard access from this local network**.
2. Save the settings and fully restart StagePilot.
3. Find the StagePilot computer's local IP address, such as `192.168.1.40`.
4. On the other computer, open `http://192.168.1.40:8765`, replacing the address and port as needed.

Allow StagePilot through the operating-system firewall if prompted. LAN dashboard access has no separate login, so enable it only on a trusted, private production network—not public Wi-Fi.

## Weekly operation

When StagePilot opens, it looks for a plan on the current local date. If none exists, it loads the next upcoming plan for the selected service type. Equally plausible plans require a manual selection instead of being chosen silently.

Before a service:

1. Confirm the correct service and service time in **Service Plan**.
2. Review **Readiness Check** and open any connection card that needs attention.
3. Send a Playback cue or use **Manual Controls** to test the timer path.
4. Confirm ProPresenter shows the selected timer as a Countdown Timer with the correct duration.
5. Keep StagePilot open during the service to monitor timing, connections, lighting cues, and events.

Service headers and reference items remain visible in Planning Center order, while song rows drive the timer workflow. The Service Plan, Now Playing, Manual Controls, Readiness Check, and Recent Event Stream widgets can be dragged or moved with their arrow controls. The chosen layout is restored on future launches.

## MIDI controls

The default Playback cue uses MIDI channel 1 and note 112 (`E7`). Velocities select the action:

| Velocity | Action |
| ---: | --- |
| 100 | Start next |
| 101 | Restart current |
| 102 | Previous |
| 103 | Next |
| 104 | Reload plan |
| 105 | Stop timer |

The note, channel, and velocities can be changed in MIDI Configuration. **Reset Position** remains available from Manual Controls and returns both StagePilot and the configured ProPresenter timer to `0:00`.

## ProPresenter and lighting

For Start Next, StagePilot stops the selected timer, configures and resets it as a Countdown Timer with the Planning Center song duration, verifies the update, and starts it. This keeps StagePilot and ProPresenter aligned while preventing an unverified timer from starting.

Lighting cue times are elapsed from the beginning of the song. Each cue sends a short MIDI Note On/Note Off pulse with its configured note and velocity. A network MIDI session can route StagePilot on one Mac to Lightkey on another.

See the [ProPresenter guide](docs/propresenter.md) and [lighting guide](docs/lights.md) for connection-specific setup.

## Planning Center access

To use the Service Plan features, sign in to Planning Center's [Personal Access Token page](https://api.planningcenteronline.com/personal_access_tokens) and create a Personal Access Token for StagePilot.

1. Create a new token with a recognizable name such as `StagePilot`.
2. Copy the token's **Client ID** into StagePilot's **Application ID** field.
3. Copy the token's **Secret** into StagePilot's **Secret** field.
4. Select **Test connection**, load the available service types, choose the service StagePilot should follow, and save the settings.

Treat the Client ID and Secret like a password. Do not include them in screenshots, logs, support requests, or GitHub issues. StagePilot stores the secret in the operating system credential store rather than its normal settings file.

## Reliability and troubleshooting

StagePilot caches the last successfully loaded service plan. If Planning Center is temporarily unavailable, the cached plan remains visible with a stale warning rather than leaving the production dashboard empty.

If something fails:

1. Open the affected connection card and run its connection test.
2. Review **Recent Event Stream** for the specific operation that failed.
3. Set the backend log level to `DEBUG`, restart StagePilot, and reproduce the issue once.
4. Attach `stagepilot-backend.log` to a [GitHub issue](https://github.com/huntrw6/stagepilot/issues).

Packaged macOS logs are stored at `~/Library/Logs/org.stagepilot.desktop/stagepilot-backend.log`. More configuration and security information is available in the [configuration guide](docs/configuration.md) and [security notes](docs/security.md).

Test the complete signal path with the same computers, network, MIDI routes, Playback session, ProPresenter timer, and lighting setup that will be used during the event.

## MultiTracks cue utility

The repository also contains [`stagepilot-cues`](tools/multitracks-cues/README.md), a standalone command-line MCP client for inspecting a MultiTracks Playback setlist, preparing the StagePilot Start Next cue, applying it only after explicit approval, and verifying the result. It has no ChatGPT, OpenAI, Claude, or other AI runtime dependency.

## Contributing

StagePilot is open source. Development, testing, and packaging instructions are in [CONTRIBUTING.md](CONTRIBUTING.md), with future direction in [ROADMAP.md](ROADMAP.md).

## License

StagePilot is licensed under the [GNU General Public License v3.0](LICENSE).
