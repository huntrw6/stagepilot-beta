import { useEffect, useMemo, useState } from "react";

import type {
  ApplicationState,
  PlanningCenterServiceType,
  PlanningCenterSettingsInput,
  PlanningCenterStatusResponse,
  PlanningCenterTestInput,
  SettingsResponse,
} from "../types";
import { SetupPanelHeader } from "./SetupPanelHeader";

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not yet";

export function PlanningCenterSetupPanel({
  state,
  settings,
  status,
  serviceTypes,
  error,
  message,
  pendingOperation,
  pendingAction,
  pendingPlanId,
  onClose,
  onTest,
  onLoadServiceTypes,
  onSave,
  onReload,
  onSelectPlan,
}: {
  state: ApplicationState;
  settings: SettingsResponse | null;
  status: PlanningCenterStatusResponse | null;
  serviceTypes: PlanningCenterServiceType[];
  error: string | null;
  message: string | null;
  pendingOperation: "test" | "load-types" | "save" | null;
  pendingAction: string | null;
  pendingPlanId: string | null;
  onClose: () => void;
  onTest: (input: PlanningCenterTestInput) => void;
  onLoadServiceTypes: () => void;
  onSave: (
    input: PlanningCenterSettingsInput,
    timezone: string,
  ) => void;
  onReload: () => void;
  onSelectPlan: (planId: string) => void;
}) {
  const serviceLoad = state.service_load;
  const publicSettings = settings?.settings.planning_center;
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [serviceTypeId, setServiceTypeId] = useState("");
  const [timezone, setTimezone] = useState("America/Los_Angeles");
  const [titlePreference, setTitlePreference] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setAppId(settings.settings.planning_center.app_id ?? "");
    setServiceTypeId(settings.settings.planning_center.service_type_id ?? "");
    setTimezone(settings.settings.timezone);
    setTitlePreference(settings.settings.planning_center.plan_title_preference ?? "");
    setPreferredTime(settings.settings.planning_center.preferred_service_time ?? "");
  }, [settings]);

  const selectedServiceTypeKnown = serviceTypes.some((value) => value.id === serviceTypeId);
  const valid = useMemo(
    () => Boolean(appId.trim() && serviceTypeId && timezone.trim()),
    [appId, serviceTypeId, timezone],
  );
  const busy = pendingOperation !== null;

  const testInput = (): PlanningCenterTestInput => ({
    ...(appId.trim() ? { app_id: appId.trim() } : {}),
    ...(secret ? { secret } : {}),
  });

  const save = () => {
    if (!publicSettings || !valid) return;
    onSave(
      {
        app_id: appId.trim(),
        service_type_id: serviceTypeId,
        plan_title_preference: titlePreference.trim() || null,
        preferred_service_time: preferredTime || null,
        upcoming_lookahead_days: publicSettings.upcoming_lookahead_days,
        request_timeout_seconds: publicSettings.request_timeout_seconds,
        ...(secret ? { secret } : {}),
        ...(removeSecret ? { remove_secret: true } : {}),
      },
      timezone.trim(),
    );
    setSecret("");
  };

  return (
    <section
      aria-busy={busy}
      aria-labelledby="planning-center-setup-heading"
      className="setup-panel mt-5 rounded-2xl border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-black/20"
      id="planning-center-configuration"
    >
      <SetupPanelHeader
        closeLabel="Close Planning Center configuration"
        description="Test your PAT, discover service types, and save the weekly service configuration securely."
        headingId="planning-center-setup-heading"
        onClose={onClose}
        status={status?.connection_status ?? state.planning_center_status}
        title="Planning Center Services"
      />

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Application ID</span>
          <input
            autoComplete="username"
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none focus:border-blue-500/60"
            disabled={busy}
            onChange={(event) => setAppId(event.target.value)}
            value={appId}
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Secret</span>
          <input
            autoComplete="current-password"
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none focus:border-blue-500/60"
            disabled={busy || removeSecret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={status?.planning_center_secret_saved ? "Saved securely — leave blank to keep" : "Enter PAT secret"}
            type="password"
            value={secret}
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Service type</span>
          <select
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100 disabled:opacity-50"
            disabled={busy || serviceTypes.length === 0}
            onChange={(event) => setServiceTypeId(event.target.value)}
            value={serviceTypeId}
          >
            <option value="">Load and choose a service type</option>
            {serviceTypeId && !selectedServiceTypeKnown && (
              <option value={serviceTypeId}>Saved service type ({serviceTypeId})</option>
            )}
            {serviceTypes.map((serviceType) => (
              <option key={serviceType.id} value={serviceType.id}>{serviceType.name}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Timezone</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none focus:border-blue-500/60"
            disabled={busy}
            onChange={(event) => setTimezone(event.target.value)}
            value={timezone}
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Plan title preference</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none focus:border-blue-500/60"
            disabled={busy}
            onChange={(event) => setTitlePreference(event.target.value)}
            placeholder="Optional, for example Sunday Morning"
            value={titlePreference}
          />
        </label>
        <label className="text-sm text-slate-300">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">Preferred service time</span>
          <input
            className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none focus:border-blue-500/60"
            disabled={busy}
            onChange={(event) => setPreferredTime(event.target.value)}
            type="time"
            value={preferredTime}
          />
        </label>
        <label className="flex items-center gap-2 self-end rounded-lg border border-white/7 bg-black/20 px-3 py-2.5 text-sm text-slate-300">
          <input
            checked={removeSecret}
            disabled={busy || !status?.planning_center_secret_saved}
            onChange={(event) => {
              setRemoveSecret(event.target.checked);
              if (event.target.checked) setSecret("");
            }}
            type="checkbox"
          />
          Remove saved secret
        </label>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3.5 py-2.5 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/20 disabled:opacity-40"
          disabled={busy || (!secret && !status?.planning_center_secret_saved)}
          onClick={() => onTest(testInput())}
          type="button"
        >
          {pendingOperation === "test" ? "Testing…" : "Test connection"}
        </button>
        <button
          className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3.5 py-2.5 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/20 disabled:opacity-40"
          disabled={busy || !status?.planning_center_secret_saved}
          onClick={onLoadServiceTypes}
          type="button"
        >
          {pendingOperation === "load-types" ? "Loading…" : "Load service types"}
        </button>
        <button
          className="rounded-lg border border-blue-500/40 bg-blue-700 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600 disabled:opacity-40"
          disabled={busy || !valid}
          onClick={save}
          type="button"
        >
          {pendingOperation === "save" ? "Saving…" : "Save settings"}
        </button>
        <button
          className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3.5 py-2.5 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/20 disabled:opacity-40"
          disabled={pendingAction !== null || !state.plugins.planning_center}
          onClick={onReload}
          type="button"
        >
          {pendingAction === "reload_plan" ? "Loading…" : "Load today’s plan"}
        </button>
      </div>

      {(error || message) && (
        <p className={`mt-4 rounded-lg border px-3 py-2 text-sm ${error ? "border-rose-400/20 bg-rose-400/10 text-rose-200" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"}`}>
          {error ?? message}
        </p>
      )}
      {!state.plugins.planning_center && (
        <p className="mt-3 text-xs text-amber-200">
          Saving this configuration enables Planning Center. Restart StagePilot to start the connection.
        </p>
      )}

      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Connection</p>
          <p className="mt-1 capitalize text-slate-200">{status?.connection_status ?? state.planning_center_status}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Credential</p>
          <p className="mt-1 text-slate-200">{status?.planning_center_secret_saved ? "Saved securely" : "Not saved"}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Target date</p>
          <p className="mt-1 text-slate-200">{serviceLoad.target_date ?? "Not selected"}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Last successful sync</p>
          <p className="mt-1 text-slate-200">{formatTimestamp(state.last_successful_plan_reload_at)}</p>
        </div>
      </div>

      {serviceLoad.candidates.length > 0 && (
        <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] p-3">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-300">Matching plans</p>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            {serviceLoad.candidates.map((candidate) => (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2" key={candidate.id}>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-100">{candidate.title}</p>
                  <p className="text-xs text-slate-500">{candidate.service_type_name} · {candidate.service_times.join(", ")}</p>
                </div>
                <button
                  className="shrink-0 rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-blue-600 disabled:opacity-50"
                  disabled={pendingPlanId !== null}
                  onClick={() => onSelectPlan(candidate.id)}
                  type="button"
                >
                  {pendingPlanId === candidate.id ? "Loading…" : "Use plan"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
