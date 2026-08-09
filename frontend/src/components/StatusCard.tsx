import type { ReactNode } from "react";

type Status = "connected" | "connecting" | "disconnected" | "error";

const statusStyles: Record<Status, string> = {
  connected: "bg-emerald-400",
  connecting: "bg-amber-400",
  disconnected: "bg-slate-500",
  error: "bg-rose-500",
};

const statusTextStyles: Record<Status, string> = {
  connected: "text-emerald-200",
  connecting: "text-amber-200",
  disconnected: "text-slate-300",
  error: "text-rose-200",
};

export function StatusCard({
  title,
  accessibleTitle = title,
  status,
  detail,
  icon,
  active,
  controls,
  onClick,
}: {
  title: string;
  accessibleTitle?: string;
  status: Status;
  detail: string;
  icon: ReactNode;
  active: boolean;
  controls: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={`${accessibleTitle} ${status}. ${detail}`}
      aria-controls={controls}
      aria-expanded={active}
      data-status={status}
      className={`status-card group min-w-0 rounded-xl border bg-stage-850 p-3 text-left shadow-panel transition-all duration-150 sm:p-4 ${
        active
          ? "border-[#ff6238]/70 bg-[#ff6238]/[0.08] shadow-[inset_3px_0_0_#ff6238,0_18px_50px_rgba(0,0,0,0.22)]"
          : "border-white/7 hover:border-white/20 hover:bg-slate-950/70"
      }`}
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true" className="status-card-surface" data-status-motion-part="surface" />
      <div className="status-card-layout grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-1 xl:gap-x-3">
        <div className="status-card-copy min-w-0">
          <p className="status-card-title whitespace-nowrap text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400 transition-all group-hover:text-slate-200" title={title}>{title}</p>
          <div className="status-card-status mt-2 flex min-w-0 items-center gap-1 transition-all xl:gap-2" data-status-motion-part="status">
            <span className={`status-card-dot h-2.5 w-2.5 shrink-0 rounded-full transition-all ${statusStyles[status]}`} />
            <span className={`status-card-status-word whitespace-nowrap font-semibold uppercase transition-all ${statusTextStyles[status]}`}>{status}</span>
          </div>
        </div>
        <span
          aria-hidden="true"
          className="status-card-icon grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-white/[0.035] text-slate-400 transition-all group-hover:text-slate-100"
          data-status-icon-background
          data-status-motion-part="icon"
        >
          <span className="status-card-icon-content grid h-9 w-9 place-items-center overflow-hidden rounded-lg transition-all">
            {icon}
          </span>
        </span>
        <p className="status-card-detail col-span-2 mt-2 truncate text-xs text-slate-500 transition-all group-hover:text-slate-300" title={detail}>{detail}</p>
      </div>
    </button>
  );
}
