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
}: {
  title: string;
  status: Status;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <article className="rounded-xl border border-white/7 bg-stage-850 p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.17em] text-slate-500">{title}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${statusStyles[status]}`} />
            <span className="font-semibold capitalize text-slate-100">{status}</span>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500" title={detail}>{detail}</p>
        </div>
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-white/5 text-slate-400">{icon}</span>
      </div>
    </article>
  );
}
