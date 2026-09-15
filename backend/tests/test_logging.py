from __future__ import annotations

from stagepilot.core.logging import redact_secrets


def test_structured_log_redaction_covers_keys_nested_values_and_messages() -> None:
    event = redact_secrets(
        object(),
        "info",
        {
            "event": "request bearer abc123 token=hidden okay",
            "authorization": "Bearer private",
            "nested": {"password": "private", "safe": "visible"},
            "items": [{"connector_token": "private"}],
        },
    )
    assert event["authorization"] == "[REDACTED]"
    assert event["nested"] == {"password": "[REDACTED]", "safe": "visible"}
    assert event["items"] == [{"connector_token": "[REDACTED]"}]
    assert event["event"] == "request bearer [REDACTED] token=[REDACTED] okay"
