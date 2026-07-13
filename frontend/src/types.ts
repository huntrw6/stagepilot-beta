export type ApplicationStatus = "starting" | "running" | "stopping" | "error";
export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";
export type PluginStatus = "stopped" | "starting" | "running" | "stopping" | "error";
export type TimerStatus = "idle" | "running" | "stopped" | "error";

export type ActionName =
  | "start_next"
  | "restart_current"
  | "previous"
  | "next"
  | "stop_timer"
  | "reload_plan"
  | "reset_position";

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
  service_times: string[];
  duration_source: string;
  songs: Song[];
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
