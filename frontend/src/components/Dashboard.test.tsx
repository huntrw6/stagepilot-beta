import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  ApplicationState,
  MidiInputsResponse,
  ServiceLoadState,
  ServicePlan,
} from "../types";
import { Dashboard } from "./Dashboard";

const loadedPlan: ServicePlan = {
  id: "previous-plan",
  title: "Previous Sunday Service",
  date: "2026-07-13",
  service_type: "Weekend Services",
  service_type_id: "weekend",
  service_times: ["09:00"],
  duration_source: "Planning Center scheduled item length",
  songs: [
    {
      id: "item-1",
      title: "Holy Forever",
      duration_seconds: 336,
      order: 1,
      service_sequence: 20,
      is_generic: false,
      source_song_id: "song-1",
    },
  ],
};

const loadedServiceState: ServiceLoadState = {
  status: "loaded",
  target_date: "2026-07-13",
  candidates: [],
  skipped_items: [],
  message: null,
  is_stale: false,
  last_attempt_at: "2026-07-13T16:00:00Z",
};

const ambiguousServiceState: ServiceLoadState = {
  status: "ambiguous",
  target_date: "2026-07-19",
  candidates: [
    {
      id: "plan-early",
      title: "Sunday Morning",
      service_type_id: "weekend",
      service_type_name: "Weekend Services",
      target_date: "2026-07-19",
      service_times: ["09:00"],
    },
    {
      id: "plan-late",
      title: "Sunday Evening",
      service_type_id: "weekend",
      service_type_name: "Weekend Services",
      target_date: "2026-07-19",
      service_times: ["18:00"],
    },
  ],
  skipped_items: [],
  message: "Multiple plans match the next service date.",
  is_stale: true,
  last_attempt_at: "2026-07-13T16:00:00Z",
};

const midi: MidiInputsResponse = {
  enabled: true,
  channel: 1,
  note: 112,
  configured_input_name: null,
  selected_input_name: null,
  inputs: [],
  mappings: {
    start_next: 100,
    restart_current: 101,
    previous: 102,
    next: 103,
    reload_plan: 104,
    stop_timer: 105,
  },
};

function applicationState(
  serviceLoad: ServiceLoadState = loadedServiceState,
  overrides: Partial<ApplicationState> = {},
): ApplicationState {
  return {
    revision: 7,
    updated_at: "2026-07-13T16:00:00Z",
    application_status: "running",
    plan: loadedPlan,
    current_song: null,
    next_song: loadedPlan.songs[0] ?? null,
    current_song_index: null,
    planning_center_status: "connected",
    midi_status: "connected",
    propresenter_status: "connected",
    lights_status: "disconnected",
    service_load: serviceLoad,
    timer: {
      status: "stopped",
      duration_seconds: null,
      started_at: null,
      last_error: null,
    },
    plugins: {
      demo: {
        name: "demo",
        version: "0.1.0",
        status: "running",
        last_error: null,
        last_activity_at: "2026-07-13T16:00:00Z",
      },
    },
    recent_events: [],
    recent_errors: [],
    last_successful_plan_reload_at: "2026-07-12T16:00:00Z",
    last_action: null,
    ...overrides,
  };
}

function renderDashboard(
  serviceLoad: ServiceLoadState,
  {
    actionMessage = null,
    error = null,
    pendingPlanId = null,
    selectPlan = vi.fn(),
    state = applicationState(serviceLoad),
  }: {
    actionMessage?: string | null;
    error?: string | null;
    pendingPlanId?: string | null;
    selectPlan?: (planId: string) => void;
    state?: ApplicationState;
  } = {},
) {
  return render(
    <Dashboard
      actionMessage={actionMessage}
      dispatch={vi.fn()}
      error={error}
      health={null}
      live
      midi={midi}
      midiMessages={[]}
      midiError={null}
      midiMessage={null}
      pendingAction={null}
      pendingMidiCue={null}
      pendingMidiOperation={null}
      pendingPlanId={pendingPlanId}
      refreshMidi={vi.fn()}
      selectMidi={vi.fn()}
      selectPlan={selectPlan}
      simulateMidi={vi.fn()}
      state={state}
    />,
  );
}

describe("Dashboard Planning Center plan states", () => {
  it("renders action notifications in the reserved header slot", () => {
    renderDashboard(loadedServiceState, {
      actionMessage: "Service position and timer reset.",
    });

    const notification = screen.getByRole("status");
    const header = screen.getByRole("banner");
    expect(header).toContainElement(notification);
    expect(notification).toHaveTextContent("Service position and timer reset.");
    expect(notification).toHaveClass("h-9", "w-fit", "max-w-full", "truncate");
  });

  it("keeps the same reserved header slot when no notification is visible", () => {
    renderDashboard(loadedServiceState);

    const header = screen.getByRole("banner");
    const notification = header.querySelector('[role="status"]');
    expect(notification).toHaveClass("h-9", "invisible");
  });

  it("queues simultaneous action and Planning Center notifications in the header", () => {
    vi.useFakeTimers();
    try {
      renderDashboard({
        ...loadedServiceState,
        status: "loading",
        message: "Looking for the current or next upcoming Planning Center plan.",
        is_stale: true,
      }, {
        actionMessage: "Service plan reload requested.",
      });

      const notification = screen.getByRole("status");
      expect(notification).toHaveTextContent("Service plan reload requested.");
      expect(screen.queryByText(/Looking for the current or next upcoming Planning Center plan/)).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(6_000));
      expect(notification).toHaveTextContent(
        "Looking for the current or next upcoming Planning Center plan. The last successful plan is still displayed as stale.",
      );

      act(() => vi.advanceTimersByTime(6_000));
      expect(notification).toHaveClass("invisible");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("retains only the two newest header notifications", () => {
    vi.useFakeTimers();
    try {
      renderDashboard({
        ...loadedServiceState,
        status: "loading",
        message: "Looking for the current or next upcoming Planning Center plan.",
      }, {
        actionMessage: "Service plan reload requested.",
        error: "Older backend error.",
      });

      const notification = screen.getByRole("status");
      expect(notification).toHaveTextContent("Service plan reload requested.");
      expect(notification).not.toHaveTextContent("Older backend error.");

      act(() => vi.advanceTimersByTime(6_000));
      expect(notification).toHaveTextContent(
        "Looking for the current or next upcoming Planning Center plan.",
      );

      act(() => vi.advanceTimersByTime(6_000));
      expect(notification).toHaveClass("invisible");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("shows errors in the same header slot with error styling", () => {
    renderDashboard(loadedServiceState, { error: "Backend unavailable." });

    expect(screen.getByRole("status")).toHaveClass("border-rose-400/25");
  });

  it("renders ambiguous candidates and sends the selected plan ID", async () => {
    const selectPlan = vi.fn();
    const user = userEvent.setup();
    renderDashboard(ambiguousServiceState, { selectPlan });

    expect(screen.getByText("Plan selection required")).toBeInTheDocument();
    expect(screen.getByText("Sunday Morning")).toBeInTheDocument();
    expect(screen.getByText("Sunday Evening")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Multiple plans match 2026-07-19" })).toBeInTheDocument();
    expect(screen.getByText("Weekend Services \u00B7 09:00")).toBeInTheDocument();
    expect(screen.getByText("Weekend Services \u00B7 18:00")).toBeInTheDocument();

    expect(screen.getByText(ambiguousServiceState.message!)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Use Sunday Evening" }));

    expect(selectPlan).toHaveBeenCalledOnce();
    expect(selectPlan).toHaveBeenCalledWith("plan-late");
  });

  it("disables every candidate while a plan selection is pending", () => {
    renderDashboard(ambiguousServiceState, { pendingPlanId: "plan-late" });

    expect(screen.getByRole("button", { name: "Use Sunday Morning" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Loading Sunday Evening" })).toBeDisabled();
  });

  it("does not report readiness when the retained plan is stale", () => {
    renderDashboard({ ...loadedServiceState, is_stale: true });

    expect(screen.getByText("Check system")).toBeInTheDocument();
    expect(screen.queryByText("All systems ready")).not.toBeInTheDocument();
  });

  it("does not report readiness when the loaded plan date differs from the target date", () => {
    renderDashboard(loadedServiceState, {
      state: applicationState(loadedServiceState, {
        plan: { ...loadedPlan, date: "2026-07-12" },
      }),
    });

    expect(screen.getByText("Check system")).toBeInTheDocument();
    expect(screen.queryByText("All systems ready")).not.toBeInTheDocument();
  });

  it("does not require the demo integration in production mode", async () => {
    const user = userEvent.setup();
    renderDashboard(loadedServiceState, {
      state: applicationState(loadedServiceState, { plugins: {} }),
    });

    expect(screen.getByRole("heading", { name: "StagePilot" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "MIDI playback input" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^MIDI \/ Playback connected/ }));
    expect(screen.getByRole("heading", { name: "MIDI playback input" })).toBeInTheDocument();
    expect(screen.getByText("No input selected")).toBeInTheDocument();
    expect(screen.queryByText("Demo integration running")).not.toBeInTheDocument();
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(screen.getByText("All systems ready")).toBeInTheDocument();
  });

  it("keeps MIDI setup closed until its connection card is clicked", async () => {
    const user = userEvent.setup();
    renderDashboard(loadedServiceState);

    expect(screen.queryByRole("heading", { name: "MIDI playback input" })).not.toBeInTheDocument();
    expect(screen.getByText("No input selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^MIDI \/ Playback connected/ }));

    expect(screen.getByRole("heading", { name: "MIDI playback input" })).toBeInTheDocument();
  });

  it("uses clear failure labels for readiness checks", () => {
    const unavailableState = applicationState(
      { ...loadedServiceState, status: "not_found" },
      {
        plan: null,
        planning_center_status: "disconnected",
        midi_status: "disconnected",
        propresenter_status: "disconnected",
        lights_status: "disconnected",
      },
    );

    renderDashboard({ ...loadedServiceState, status: "not_found" }, {
      state: unavailableState,
    });

    expect(screen.getByText("Planning Center disconnected")).toBeInTheDocument();
    expect(screen.getByText("Service plan not loaded")).toBeInTheDocument();
    expect(screen.getByText("Song durations invalid")).toBeInTheDocument();
    expect(screen.getByText("MIDI input disconnected")).toBeInTheDocument();
    expect(screen.getByText("ProPresenter disconnected")).toBeInTheDocument();
  });

  it("shows when the service plan was last successfully loaded", () => {
    renderDashboard(loadedServiceState, {
      state: applicationState(loadedServiceState, {
        last_successful_plan_reload_at: "2026-06-15T18:28:00",
      }),
    });

    expect(screen.getByText("Current as of 18:28 06-15-2026")).toBeInTheDocument();
    expect(screen.queryByText("Planning Center scheduled item length")).not.toBeInTheDocument();
  });

  it("displays a loaded upcoming plan as ready", () => {
    const upcomingServiceLoad: ServiceLoadState = {
      ...loadedServiceState,
      target_date: "2026-07-19",
      last_attempt_at: "2026-07-13T16:00:00Z",
    };
    const upcomingPlan: ServicePlan = {
      ...loadedPlan,
      id: "upcoming-plan",
      title: "Upcoming Sunday Service",
      date: "2026-07-19",
    };

    renderDashboard(upcomingServiceLoad, {
      state: applicationState(upcomingServiceLoad, {
        plan: upcomingPlan,
        plugins: {},
      }),
    });

    expect(screen.getByText("Upcoming Sunday Service")).toBeInTheDocument();
    expect(screen.getByText("Weekend Services \u00B7 2026-07-19 \u00B7 09:00")).toBeInTheDocument();
    expect(screen.getByText("Service plan loaded")).toBeInTheDocument();
    expect(screen.getByText("Service plan")).toBeInTheDocument();
    expect(screen.getAllByText("Ready").length).toBeGreaterThan(0);
    expect(screen.getByText("All systems ready")).toBeInTheDocument();
    expect(screen.queryByText("TodayÃ¢â‚¬â„¢s plan loaded")).not.toBeInTheDocument();
    expect(screen.queryByText("TodayÃ¢â‚¬â„¢s service")).not.toBeInTheDocument();
  });

  it("interleaves subdued non-song reference items with their durations", () => {
    renderDashboard({
      ...loadedServiceState,
      skipped_items: [
        {
          item_id: "header-1",
          title: "Welcome",
          description: "This header description is intentionally hidden",
          item_type: "header",
          sequence: 10,
          duration_seconds: 90,
          reason: "header",
        },
        {
          item_id: "item-2",
          title: "Announcements",
          description: "Pastor John",
          item_type: "item",
          sequence: 30,
          duration_seconds: 120,
          reason: "not_song",
        },
      ],
    });

    expect(screen.queryByText("2 non-song items were skipped")).not.toBeInTheDocument();
    expect(screen.queryByText("2 reference items")).not.toBeInTheDocument();
    const rows = within(screen.getByRole("list", { name: "Service plan order" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Welcome");
    expect(rows[0]).not.toHaveTextContent("01:30");
    expect(rows[0]).not.toHaveTextContent("Reference");
    expect(rows[0]).not.toHaveTextContent("This header description is intentionally hidden");
    expect(screen.getByText("Welcome")).toHaveClass("text-xs", "font-extrabold");
    expect(rows[1]).toHaveTextContent("Holy Forever");
    expect(rows[2]).toHaveTextContent("Announcements");
    expect(rows[2]).toHaveTextContent("Pastor John");
    expect(rows[2]).toHaveTextContent("02:00");
    expect(rows[2]).not.toHaveTextContent("Reference");
    expect(screen.getByText("Welcome")).toHaveClass("text-slate-400");
    expect(screen.getByText("Pastor John")).toHaveClass("text-slate-600");
  });
});

describe("Dashboard widget layout", () => {
  it("moves dashboard widgets with arrows and saves the manual-controls position", async () => {
    window.localStorage.removeItem("stagepilot.dashboard-widget-order.v1");
    const user = userEvent.setup();
    renderDashboard(loadedServiceState);

    const servicePlan = screen.getByTestId("dashboard-widget-service-plan");
    const nowPlaying = screen.getByTestId("dashboard-widget-now-playing");
    expect(servicePlan).toHaveStyle({ order: "0" });
    expect(nowPlaying).toHaveStyle({ order: "1" });

    await user.click(screen.getByRole("button", { name: "Move Service Plan later" }));

    expect(servicePlan).toHaveStyle({ order: "1" });
    expect(nowPlaying).toHaveStyle({ order: "0" });
    expect(JSON.parse(window.localStorage.getItem("stagepilot.dashboard-widget-order.v1")!)).toEqual([
      "now-playing",
      "service-plan",
      "manual-controls",
      "readiness",
      "events",
    ]);
    expect(screen.getByRole("button", { name: "Drag Manual Controls to a new dashboard position" })).toBeInTheDocument();
    window.localStorage.removeItem("stagepilot.dashboard-widget-order.v1");
  });

  it("snaps a widget to the hovered position when a pointer drag is released", () => {
    window.localStorage.removeItem("stagepilot.dashboard-widget-order.v1");
    renderDashboard(loadedServiceState);

    const servicePlan = screen.getByTestId("dashboard-widget-service-plan");
    const events = screen.getByTestId("dashboard-widget-events");
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Drag Service Plan to a new dashboard position" }),
    );
    fireEvent.pointerEnter(events);
    fireEvent.pointerUp(window);

    expect(servicePlan).toHaveStyle({ order: "4" });
    expect(events).toHaveStyle({ order: "3" });
    expect(JSON.parse(window.localStorage.getItem("stagepilot.dashboard-widget-order.v1")!)).toEqual([
      "now-playing",
      "manual-controls",
      "readiness",
      "events",
      "service-plan",
    ]);
    window.localStorage.removeItem("stagepilot.dashboard-widget-order.v1");
  });
});

describe("Dashboard connection configuration panels", () => {
  it("keeps the retained first-launch setup UI disabled", () => {
    renderDashboard(loadedServiceState, {
      state: applicationState(loadedServiceState, { plugins: {} }),
    });

    expect(screen.queryByLabelText("StagePilot setup progress")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Finish configuring StagePilot" }),
    ).not.toBeInTheDocument();
  });

  it("opens only the clicked connection and toggles it closed on a second click", async () => {
    const user = userEvent.setup();
    renderDashboard(loadedServiceState, {
      state: applicationState(loadedServiceState, { plugins: {} }),
    });

    const planningCenter = screen.getByRole("button", { name: /^Planning Center connected/ });
    const midiConnection = screen.getByRole("button", { name: /^MIDI \/ Playback connected/ });

    expect(planningCenter).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "Planning Center Services" })).not.toBeInTheDocument();

    await user.click(planningCenter);

    expect(planningCenter).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: "Planning Center Services" })).toBeInTheDocument();

    await user.click(midiConnection);

    expect(planningCenter).toHaveAttribute("aria-expanded", "false");
    expect(midiConnection).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByRole("heading", { name: "Planning Center Services" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MIDI playback input" })).toBeInTheDocument();

    await user.click(midiConnection);

    expect(midiConnection).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("heading", { name: "MIDI playback input" })).not.toBeInTheDocument();
  });

  it("provides close buttons for all five connection panels", async () => {
    const user = userEvent.setup();
    renderDashboard(loadedServiceState, {
      state: applicationState(loadedServiceState, { plugins: {} }),
    });

    const panels = [
      {
        card: /^Planning Center connected/,
        close: "Close Planning Center configuration",
        heading: "Planning Center Services",
      },
      {
        card: /^MIDI \/ Playback connected/,
        close: "Close MIDI / Playback configuration",
        heading: "MIDI playback input",
      },
      {
        card: /^ProPresenter connected/,
        close: "Close ProPresenter configuration",
        heading: "ProPresenter countdown",
      },
      {
        card: /^Lights disconnected/,
        close: "Close Lights configuration",
        heading: "Lighting configuration",
      },
      {
        card: /^StagePilot backend connected/,
        close: "Close StagePilot backend configuration",
        heading: "StagePilot backend",
      },
    ] as const;

    for (const panel of panels) {
      await user.click(screen.getByRole("button", { name: panel.card }));
      expect(screen.getByRole("heading", { name: panel.heading })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: panel.close }));
      expect(screen.queryByRole("heading", { name: panel.heading })).not.toBeInTheDocument();
    }
  });

  it("shows a live remaining clock alongside elapsed song duration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T16:00:30Z"));
    try {
      renderDashboard(loadedServiceState, {
        state: applicationState(loadedServiceState, {
          current_song: loadedPlan.songs[0] ?? null,
          current_song_index: 0,
          timer: {
            status: "running",
            duration_seconds: 336,
            started_at: "2026-07-13T16:00:00Z",
            last_error: null,
          },
        }),
      });

      expect(screen.getByText("Time remaining")).toBeInTheDocument();
      expect(screen.getByText("05:06")).toBeInTheDocument();
      expect(screen.getByText("Elapsed")).toBeInTheDocument();
      expect(screen.getByText("00:30")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("advances the main countdown immediately instead of lagging ProPresenter", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T16:00:00.010Z"));
    try {
      const shortSong = {
        ...loadedPlan.songs[0]!,
        duration_seconds: 263,
      };
      renderDashboard(loadedServiceState, {
        state: applicationState(loadedServiceState, {
          plan: { ...loadedPlan, songs: [shortSong] },
          current_song: shortSong,
          current_song_index: 0,
          timer: {
            status: "running",
            duration_seconds: 263,
            started_at: "2026-07-13T16:00:00.000Z",
            last_error: null,
          },
        }),
      });

      expect(screen.getByText("04:22")).toBeInTheDocument();
      expect(screen.getByText("00:00")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

