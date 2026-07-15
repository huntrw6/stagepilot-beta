import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MidiInputsResponse, MidiMonitorMessage } from "../types";
import { MidiSetupPanel } from "./MidiSetupPanel";

const midi: MidiInputsResponse = {
  enabled: true,
  channel: 3,
  note: 112,
  configured_input_name: "Startup Controller",
  selected_input_name: null,
  inputs: [
    {
      id: "a".repeat(64),
      name: "Playback Controller",
      ambiguous: false,
      selected: false,
      connected: false,
    },
  ],
  mappings: {
    start_next: 100,
    restart_current: 101,
    previous: 102,
    next: 103,
    reload_plan: 104,
    stop_timer: 105,
  },
};

function renderPanel({
  value = midi,
  onRefresh = vi.fn(),
  onSelect = vi.fn(),
  onSimulate = vi.fn(),
  messages = [],
  source,
  onSourceChange,
}: {
  value?: MidiInputsResponse;
  onRefresh?: () => void;
  onSelect?: (inputId: string | null) => void;
  onSimulate?: (cue: "start_next" | "restart_current" | "previous" | "next" | "reload_plan" | "stop_timer") => void;
  messages?: MidiMonitorMessage[];
  source?: "simulated" | "real";
  onSourceChange?: (source: "simulated" | "real") => void;
} = {}) {
  render(
    <MidiSetupPanel
      error={null}
      message={null}
      midi={value}
      messages={messages}
      onRefresh={onRefresh}
      onSelect={onSelect}
      onSimulate={onSimulate}
      onSourceChange={onSourceChange}
      pendingCue={null}
      pendingOperation={null}
      source={source}
    />,
  );
}

describe("MidiSetupPanel", () => {
  it("shows persistent configuration and connects an available input", async () => {
    const onRefresh = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPanel({ onRefresh, onSelect });

    expect(screen.getByText(/persist between StagePilot launches/i)).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => {
        const text = element?.textContent?.replace(/\s+/g, " ").trim();
        return element?.tagName === "SPAN" && text === "Channel 3 \u00B7 Note 112";
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Startup default: Startup Controller")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Available input"), "a".repeat(64));
    await user.click(screen.getByRole("button", { name: "Connect" }));
    await user.click(screen.getByRole("button", { name: "Refresh inputs" }));

    expect(onSelect).toHaveBeenCalledWith("a".repeat(64));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("simulates every cue while no hardware input is connected", async () => {
    const onSimulate = vi.fn();
    const user = userEvent.setup();
    renderPanel({ onSimulate });

    for (const label of [
      "Start next",
      "Restart current",
      "Previous",
      "Next",
      "Reload plan",
      "Stop timer",
    ]) {
      await user.click(screen.getByRole("button", { name: new RegExp(label) }));
    }

    expect(onSimulate.mock.calls.map(([cue]) => cue)).toEqual([
      "start_next",
      "restart_current",
      "previous",
      "next",
      "reload_plan",
      "stop_timer",
    ]);
    expect(screen.getByText(/remain available while the selected hardware input is disconnected/i)).toBeInTheDocument();
  });

  it("offers an explicit disconnect for the selected input", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPanel({
      onSelect,
      value: {
        ...midi,
        selected_input_name: "Playback Controller",
        inputs: [{ ...midi.inputs[0]!, selected: true, connected: true }],
      },
    });

    expect(screen.getByText("Connected: Playback Controller")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("disables setup and cue tests when the MIDI plugin is disabled", () => {
    renderPanel({ value: { ...midi, enabled: false } });

    expect(screen.getByText(/Select Real MIDI \/ Playback above/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Available input")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Start next/ })).toBeDisabled();
  });

  it("saves the real MIDI source from the disabled setup panel", async () => {
    const onSourceChange = vi.fn();
    const user = userEvent.setup();
    renderPanel({
      onSourceChange,
      source: "simulated",
      value: { ...midi, enabled: false },
    });

    await user.selectOptions(screen.getByLabelText("MIDI source"), "real");
    await user.click(screen.getByRole("button", { name: "Save MIDI mode" }));

    expect(onSourceChange).toHaveBeenCalledWith("real");
  });

  it("shows an omitted mapping and disables its cue test", () => {
    const mappings = { ...midi.mappings };
    delete mappings.stop_timer;
    renderPanel({ value: { ...midi, mappings } });

    expect(screen.getByRole("button", { name: /Stop timer/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Stop timer/ })).toHaveAttribute(
      "title",
      "No MIDI velocity is configured for this cue.",
    );
  });

  it("shows received note details and the reason an input was ignored", () => {
    renderPanel({
      messages: [
        {
          timestamp: "2026-07-13T20:00:00Z",
          input_name: "Network Session 1",
          message_type: "note_on",
          channel: 2,
          note: 16,
          note_name: "E-1",
          velocity: 100,
          disposition: "wrong_channel",
          detail: "Ignored: StagePilot listens on channel 1.",
          action: null,
          simulated: false,
        },
      ],
    });

    const monitor = within(screen.getByRole("table"));
    expect(monitor.getByText("Network Session 1")).toBeInTheDocument();
    expect(monitor.getByText("E-1 (16)")).toBeInTheDocument();
    expect(monitor.getByText("2")).toBeInTheDocument();
    expect(monitor.getByText("100")).toBeInTheDocument();
    expect(monitor.getByText("wrong channel")).toHaveAttribute(
      "title",
      "Ignored: StagePilot listens on channel 1.",
    );
  });
});

