import type { ApplicationState } from "../types";

const formatTimestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "Not yet";

export function PlanningCenterSetupPanel({
  state,
  pendingAction,
  pendingPlanId,
  onClose,
  onReload,
  onSelectPlan,
}: {
  state: ApplicationState;
  pendingAction: string | null;
  pendingPlanId: string | null;
  onClose: () => void;
  onReload: () => void;
  onSelectPlan: (planId: string) => void;
}) {
  const serviceLoad = state.service_load;

  return (
    <section
      aria-labelledby="planning-center-setup-heading"
      className="mt-5 rounded-xl border border-amber-400/15 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.09),transparent_45%),#111923] p-5 shadow-panel"
      id="planning-center-configuration"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-300">Production setup</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100" id="planning-center-setup-heading">
            Planning Center Services
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Review the active service plan, reload it, or choose a matching plan when discovery is ambiguous.
          </p>
        </div>
        <button
          aria-label="Close Planning Center configuration"
          className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-lg text-slate-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
          onClick={onClose}
          title="Close"
          type="button"
        >
          ×
        </button>
      </div>

      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Connection</p>
          <p className="mt-1 capitalize text-slate-200">{state.planning_center_status}</p>
        </div>
        <div className="rounded-lg border border-white/5 bg-black/20 px-3 py-3">
          <p className="text-xs uppercase tracking-wider text-slate-500">Service type</p>
          <p className="mt-1 text-slate-200">{state.plan?.service_type ?? "Configured at startup"}</p>
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
                  className="shrink-0 rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-amber-200 disabled:cursor-wait disabled:opacity-50"
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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          className="rounded-lg border border-amber-400/35 bg-amber-400/15 px-3.5 py-2.5 text-sm font-semibold text-amber-200 transition hover:bg-amber-400/25 disabled:cursor-wait disabled:opacity-40"
          disabled={pendingAction !== null}
          onClick={onReload}
          type="button"
        >
          {pendingAction === "reload_plan" ? "Reloading…" : "Reload service plan"}
        </button>
        <p className="text-xs text-slate-500">
          Credentials and the startup service type remain protected in the backend environment configuration.
        </p>
      </div>
    </section>
  );
}
