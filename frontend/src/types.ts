export type ApplicationStatus = "starting" | "running" | "stopping" | "error";
export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
export type PluginStatus = "stopped" | "starting" | "running" | "stopping" | "error";
export type TimerStatus = "idle" | "running" | "stopped" | "error";
export type ServiceLoadStatus =
  | "idle"
  | "loading"
  | "loaded"
  | "not_found"
  | "ambiguous"
  | "error";

export type ActionName =
  | "start_next"
  | "restart_current"
  | "previous"
  | "next"
  | "stop_timer"
  | "reload_plan"
  | "reset_position";

export type MidiCueName =
  | "start_next"
  | "restart_current"
  | "previous"
  | "next"
  | "reload_plan"
  | "stop_timer";

export type MidiMessageDisposition =
  | "dispatched"
  | "action_rejected"
  | "duplicate"
  | "unmapped"
  | "wrong_channel"
  | "note_release"
  | "queue_full"
  | "error";

export interface Song {
  id: string;
  title: string;
  duration_seconds: number | null;
  formatted_duration?: string | null;
  order: number;
  is_generic: boolean;
  source_song_id: string | null;
}

export interface ServicePlan {
  id: string;
  title: string;
  date: string;
  service_type: string;
  service_type_id: string | null;
  service_times: string[];
  duration_source: string;
  songs: Song[];
}

export interface ServicePlanCandidate {
  id: string;
  title: string;
  service_type_id: string;
  service_type_name: string;
  target_date: string;
  service_times: string[];
}

export interface SkippedServiceItem {
  item_id: string;
  title: string;
  item_type: string;
  sequence: number;
  reason: string;
}

export interface ServiceLoadState {
  status: ServiceLoadStatus;
  target_date: string | null;
  candidates: ServicePlanCandidate[];
  skipped_items: SkippedServiceItem[];
  message: string | null;
  is_stale: boolean;
  last_attempt_at: string | null;
}

export interface PluginHealth {
  name: string;
  version: string;
  status: PluginStatus;
  last_error: string | null;
  last_activity_at: string | null;
}

export interface EventSummary {
  id: string;
  type: string;
  timestamp: string;
  source: string;
}

export interface ErrorSummary {
  timestamp: string;
  component: string;
  message: string;
  event_id: string | null;
}

export interface ApplicationState {
  revision: number;
  updated_at: string;
  application_status: ApplicationStatus;
  plan: ServicePlan | null;
  current_song: Song | null;
  next_song: Song | null;
  current_song_index: number | null;
  planning_center_status: ConnectionStatus;
  midi_status: ConnectionStatus;
  propresenter_status: ConnectionStatus;
  service_load: ServiceLoadState;
  timer: {
    status: TimerStatus;
    duration_seconds: number | null;
    started_at: string | null;
    last_error: string | null;
  };
  plugins: Record<string, PluginHealth>;
  recent_events: EventSummary[];
  recent_errors: ErrorSummary[];
  last_successful_plan_reload_at: string | null;
  last_action: string | null;
}

export interface HealthResponse {
  status: "healthy" | "degraded";
  version: string;
  application_status: ApplicationStatus;
  plugins: PluginHealth[];
}

export interface StateEnvelope {
  type: "state.snapshot";
  data: ApplicationState;
}

export interface ActionResponse {
  action: ActionName;
  accepted: boolean;
  message: string;
  state: ApplicationState;
}

export interface PlanSelectionResponse {
  accepted: boolean;
  message: string;
  state: ApplicationState;
}

export interface MidiInput {
  id: string;
  name: string;
  ambiguous: boolean;
  selected: boolean;
  connected: boolean;
}

export interface MidiInputsResponse {
  enabled: boolean;
  channel: number;
  note: number;
  configured_input_name: string | null;
  selected_input_name: string | null;
  inputs: MidiInput[];
  mappings: Partial<Record<MidiCueName, number>>;
}

export interface MidiMonitorMessage {
  timestamp: string;
  input_name: string | null;
  message_type: "note_on" | "note_off";
  channel: number;
  note: number;
  note_name: string;
  velocity: number;
  disposition: MidiMessageDisposition;
  detail: string;
  action: ActionName | null;
  simulated: boolean;
}

export interface MidiMonitorResponse {
  messages: MidiMonitorMessage[];
}

export interface MidiInputSelectionResponse {
  accepted: boolean;
  message: string;
  midi: MidiInputsResponse;
}

export interface MidiCueSimulationResponse {
  cue: MidiCueName;
  action: ActionName;
  accepted: boolean;
  message: string;
  state: ApplicationState;
}

export interface ProPresenterTimer {
  id: string;
  name: string;
  index: number;
  is_countdown: boolean;
  state: string | null;
}

export interface ProPresenterStatusResponse {
  enabled: boolean;
  host: string;
  port: number;
  timer_name: string;
  request_timeout_seconds: number;
  connection_status: ConnectionStatus;
  detail: string | null;
  timers: ProPresenterTimer[];
  selected_timer_id: string | null;
  timer_found: boolean;
  last_checked_at: string | null;
}

export interface ProPresenterSettingsInput {
  host: string;
  port: number;
  timer_name: string;
  request_timeout_seconds: number;
}

export interface ProPresenterOperationResponse {
  accepted: boolean;
  message: string;
  propresenter: ProPresenterStatusResponse;
}
