import type { ReactNode } from "react";

type Status = "connected" | "connecting" | "disconnected" | "error";

const statusStyles: Record<Status, string> = {
  connected: "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.55)]",
  connecting: "bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.5)]",
  disconnected: "bg-slate-500",
  error: "bg-rose-500 shadow-[0_0_14px_rgba(244,63,94,0.5)]",
};

export function StatusCard({
  title,
  status,
  detail,
  icon,
  active,
  controls,
  onClick,
}: {
  title: string;
  status: Status;
  detail: string;
  icon: ReactNode;
  active: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={active}
      className={`group min-w-0 rounded-xl border bg-stage-850 p-2 text-left shadow-panel transition focus:outline-none focus:ring-2 focus:ring-sky-400/60 sm:p-4 ${
        active
          ? "border-sky-400/50 bg-slate-950/70"
          : "border-white/7 hover:border-white/20 hover:bg-slate-950/70"
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="flex min-w-0 items-start justify-between gap-1 xl:gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.17em] text-slate-500 transition-colors group-hover:text-slate-300" title={title}>{title}</p>
          <div className="mt-2 flex min-w-0 items-center gap-1 xl:gap-2">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusStyles[status]}`} />
            <span className="truncate font-semibold capitalize text-slate-100">{status}</span>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500 transition-colors group-hover:text-slate-300" title={detail}>{detail}</p>
        </div>
        <span
          aria-hidden="true"
          className="hidden h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/5 text-slate-400 transition-colors group-hover:text-slate-100 xl:grid"
          data-status-icon-background
        >
          <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-lg">
            {icon}
          </span>
        </span>
      </div>
    </button>
  );
}
