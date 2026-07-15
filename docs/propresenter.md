# ProPresenter integration

StagePilot controls one reusable ProPresenter countdown timer through ProPresenter's local HTTP API.

## Required ProPresenter setup

1. Open ProPresenter **Settings → Network** and enable the API.
2. Note the configured API port. StagePilot defaults to `1025` but does not assume that value.
3. Create a countdown timer named `Song Countdown`, or select another detected countdown timer in StagePilot.
4. Link the timer to the desired ProPresenter stage layout.

## StagePilot configuration

The production setup panel supports session-level changes to:

- Host
- Port
- Timer name
- Request timeout
- Connection test
- Timer rediscovery

Environment defaults are available for unattended startup:

```dotenv
STAGEPILOT_PROPRESENTER_ENABLED=true
STAGEPILOT_PROPRESENTER_HOST=127.0.0.1
STAGEPILOT_PROPRESENTER_PORT=1025
STAGEPILOT_PROPRESENTER_TIMER_NAME=Song Countdown
STAGEPILOT_PROPRESENTER_TIMEOUT_SECONDS=3
STAGEPILOT_PROPRESENTER_RECONNECT_INITIAL_SECONDS=1
STAGEPILOT_PROPRESENTER_RECONNECT_MAX_SECONDS=30
STAGEPILOT_PROPRESENTER_HEALTH_CHECK_SECONDS=10
```

When demo mode supplies the service plan but real ProPresenter output is desired, also set:

```dotenv
STAGEPILOT_DEMO_MODE=true
STAGEPILOT_DEMO_SIMULATE_PROPRESENTER=false
```

## Timer sequence

For `song.started` and `song.restarted`, StagePilot performs:

1. Stop
2. Set countdown duration
3. Reset
4. Start

`timer.stop_requested` stops the real ProPresenter timer.

## Recovery

StagePilot periodically probes ProPresenter. If ProPresenter is offline at startup or restarts later, the plugin retries with capped exponential backoff. Timer identities are rediscovered by visible name, and failed timer operations clear the cached timer before one immediate retry.

The dashboard distinguishes:

- API unreachable
- API connected but configured timer missing
- Timer found and ready
- Timer command failure
