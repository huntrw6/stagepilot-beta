from stagepilot.core.config import (
    DemoSettings,
    MidiNoteMappings,
    ProPresenterSettings,
    Settings,
)


def test_midi_defaults_match_documented_playback_cues() -> None:
    mappings = MidiNoteMappings()
    assert mappings.start_next == 100
    assert mappings.restart_current == 101
    assert mappings.previous == 102
    assert mappings.next == 103
    assert mappings.reload_plan == 104
    assert mappings.stop_timer == 105


def test_propresenter_settings_build_local_api_url() -> None:
    settings = ProPresenterSettings(host=" 192.168.4.40 ", port=1025)
    assert settings.host == "192.168.4.40"
    assert settings.base_url == "http://192.168.4.40:1025"


def test_demo_integrations_remain_simulated_by_default() -> None:
    settings = Settings(demo_mode=True)
    assert settings.demo == DemoSettings(
        simulate_midi=True,
        simulate_propresenter=True,
    )
