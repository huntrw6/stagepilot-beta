# macOS ad-hoc signing

StagePilot's community macOS release does not currently use Apple Developer ID
or notarization. It uses the supported ad-hoc identity (`-`), so users may need
to right-click **Open** or approve StagePilot under **System Settings → Privacy
& Security** after downloading it.

## Why Hardened Runtime is disabled

The backend is a PyInstaller one-file executable. At startup it extracts its
embedded Python framework into a temporary `_MEI...` directory. Tauri's default
macOS Hardened Runtime setting signs external sidecars with the `runtime` flag.
Apple's library validation then rejects the extracted ad-hoc Python framework
because an ad-hoc build has no Apple Team ID.

StagePilot therefore explicitly combines:

- `signingIdentity: "-"` for ad-hoc application signing;
- `hardenedRuntime: false` for this non-notarized release flavor; and
- `minimumSystemVersion: "12.0"`.

This reproduces the signature produced by the successful incident repair
without requiring users to repair an installed application. StagePilot does not
use a self-signed certificate and does not add a disable-library-validation
entitlement.

Apple explains that Hardened Runtime enables library validation, which requires
loaded code to be Apple-signed or signed by the same Team ID:
[Disable Library Validation Entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.cs.disable-library-validation).
Tauri documents `hardenedRuntime` and its default in the
[Tauri 2 configuration reference](https://v2.tauri.app/reference/config/).
PyInstaller documents its macOS binary processing and code-signing behavior in
its [macOS feature notes](https://pyinstaller.org/en/stable/feature-notes.html#macos-binary-code-signing).

## Final-artifact verification

`scripts/verify_macos_release_bundle.sh` verifies the actual `.app`, DMG, and
`.app.tar.gz` updater payload. For each format it:

1. checks the expected Intel or Apple Silicon architecture;
2. verifies the application bundle recursively with `codesign`;
3. rejects a backend sidecar carrying the Hardened Runtime flag or an unexpected
   Team ID;
4. verifies the main executable and sidecar do not require newer than macOS
   12.0; and
5. starts that exact packaged sidecar on an isolated port and requires successful
   `/api/v1/health` and `/api/v1/state` responses.

The GitHub release workflow runs all three checks on native Intel and Apple
Silicon runners before it collects or uploads release assets.

Developers can inspect a built sidecar with:

```sh
codesign --verify --strict --verbose=4 /path/to/stagepilot-backend
codesign -d --verbose=4 /path/to/stagepilot-backend 2>&1
codesign -d --entitlements :- /path/to/stagepilot-backend 2>/dev/null
xcrun vtool -show-build /path/to/stagepilot-backend
```

The backend log is
`~/Library/Logs/org.stagepilot.desktop/stagepilot-backend.log`. StagePilot keeps
one rotated previous log after the current file reaches 5 MiB.

## Future Developer ID releases

A future paid Developer ID build should use a real Developer ID Application
identity, Hardened Runtime, secure timestamps, appropriate narrowly scoped
entitlements if needed, and Apple notarization. That is a separate release
flavor and must be tested against PyInstaller's extracted libraries. Tauri
updater signatures remain independent: they authenticate updates inside
StagePilot and are required whether Apple signing is ad-hoc or Developer ID.
