# Unsigned and ad-hoc-signed macOS updates

StagePilot is not notarized with an Apple Developer account. macOS application
bundles are ad-hoc signed with identity `-`, while Tauri updater archives are
independently signed with the long-term StagePilot updater key.

Ad-hoc signing does not establish an Apple-verified developer identity. The
mandatory Tauri signature proves an update was produced with StagePilot's
private updater key, but it is not Apple notarization.

The first updater-enabled release must be downloaded manually, moved to
`/Applications/StagePilot.app`, and approved through Privacy & Security if
macOS blocks it. Later releases are intended to be downloaded inside
StagePilot, avoiding the usual browser-download path that adds quarantine
metadata. Apple does not guarantee prompt-free updating for unsigned apps on
every macOS version.

Manually downloading a replacement may add `com.apple.quarantine` again.
StagePilot never disables Gatekeeper, clears quarantine, invokes AppleScript,
or accepts an updater artifact whose Tauri signature fails.

## Diagnostics

Before and after an in-app update, record:

```bash
xattr -l /Applications/StagePilot.app
codesign --display --verbose=4 /Applications/StagePilot.app
codesign --verify --deep --strict --verbose=2 /Applications/StagePilot.app
```

Do not remove quarantine during validation. Record the macOS version,
architecture, updater archive type, signing result, download path, and any
Gatekeeper prompt. A prompt must be documented rather than hidden.
