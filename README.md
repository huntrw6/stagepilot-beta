# StagePilot

StagePilot brings the moving parts of a live production into one dependable dashboard. It loads service plans from Planning Center, listens for MIDI cues from MultiTracks Playback, keeps a ProPresenter countdown in sync, and sends scheduled MIDI cues to a lighting controller such as Lightkey.

## Download StagePilot 1.0

Download the installer for your computer from the [StagePilot 1.0.0 release](https://github.com/huntrw6/stagepilot/releases/tag/v1.0.0):

- [Windows x64 installer](https://github.com/huntrw6/stagepilot/releases/download/v1.0.0/StagePilot_1.0.0_x64-setup.exe)
- [Intel Mac DMG](https://github.com/huntrw6/stagepilot/releases/download/v1.0.0/StagePilot_1.0.0_x64.dmg)
- [Apple Silicon Mac DMG](https://github.com/huntrw6/stagepilot/releases/download/v1.0.0/StagePilot_1.0.0_aarch64.dmg)

On **Windows**, run the installer and open StagePilot from the Start menu.

On **macOS**, open the DMG and drag StagePilot to Applications. On Mac, StagePilot is not currently code-signed or notarized, so the operating system may ask you to confirm that you trust the application. If the application can't be opened on your computer try opening **System Settings**, **Privacy & Security**, scrolling to the bottom of the menu it should give you an option to **Open Anyway** where it says *"StagePilot was blocked to protect your Mac."* You also may need to adjust the setting *Allow applications from* under Security to **App Store & Known Developers**. Then it should give you the option to *Move to Trash* or **Open Anyway** to open the app.
Only install downloads from the **official StagePilot GitHub release page**.

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

## Contributing

StagePilot is open source. Development, testing, and packaging instructions are in [CONTRIBUTING.md](CONTRIBUTING.md), with future direction in [ROADMAP.md](ROADMAP.md).

## License

StagePilot is licensed under the [GNU General Public License v3.0](LICENSE).
