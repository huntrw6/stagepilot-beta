import { render, screen } from "@testing-library/react";
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
    pendingPlanId = null,
    selectPlan = vi.fn(),
    state = applicationState(serviceLoad),
  }: {
    pendingPlanId?: string | null;
    selectPlan?: (planId: string) => void;
    state?: ApplicationState;
  } = {},
) {
  render(
    <Dashboard
      actionMessage={null}
      dispatch={vi.fn()}
      error={null}
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
  it("renders ambiguous candidates and sends the selected plan ID", async () => {
    const selectPlan = vi.fn();
    const user = userEvent.setup();
    renderDashboard(ambiguousServiceState, { selectPlan });

    expect(screen.getByText("Plan selection required")).toBeInTheDocument();
    expect(screen.getByText("Sunday Morning")).toBeInTheDocument();
    expect(screen.getByText("Sunday Evening")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Multiple plans match 2026-07-19" })).toBeInTheDocument();
    expect(screen.getByText("Weekend Services Â· 09:00")).toBeInTheDocument();
    expect(screen.getByText("Weekend Services Â· 18:00")).toBeInTheDocument();

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

  it("does not require the demo integration in production mode", () => {
    renderDashboard(loadedServiceState, {
      state: applicationState(loadedServiceState, { plugins: {} }),
    });

    expect(screen.getByText(/Production mode/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MIDI playback input" })).toBeInTheDocument();
    expect(screen.getByText("No input selected")).toBeInTheDocument();
    expect(screen.queryByText("Demo integration running")).not.toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("All systems ready")).toBeInTheDocument();
  });

  it("does not render production MIDI setup in demo mode", () => {
    renderDashboard(loadedServiceState);

    expect(screen.queryByRole("heading", { name: "MIDI playback input" })).not.toBeInTheDocument();
    expect(screen.getByText("Listening for demo actions")).toBeInTheDocument();
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
    expect(screen.getByText("Weekend Services Â· 2026-07-19 Â· 09:00")).toBeInTheDocument();
    expect(screen.getByText("Service plan loaded")).toBeInTheDocument();
    expect(screen.getByText("Service plan")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("All systems ready")).toBeInTheDocument();
    expect(screen.queryByText("Todayâ€™s plan loaded")).not.toBeInTheDocument();
    expect(screen.queryByText("Todayâ€™s service")).not.toBeInTheDocument();
  });

  it("shows skipped service item titles", () => {
    renderDashboard({
      ...loadedServiceState,
      skipped_items: [
        {
          item_id: "header-1",
          title: "Welcome",
          item_type: "header",
          sequence: 1,
          reason: "header",
        },
        {
          item_id: "item-2",
          title: "Announcements",
          item_type: "item",
          sequence: 2,
          reason: "not_song",
        },
      ],
    });

    expect(screen.getByText("2 non-song items were skipped")).toBeInTheDocument();
    expect(screen.getByText(/Welcome/)).toHaveTextContent("Announcements");
  });
});
