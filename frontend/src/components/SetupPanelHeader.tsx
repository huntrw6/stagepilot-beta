import type { ConnectionStatus } from "../types";

type SetupPanelStatus = ConnectionStatus | "loading";

const statusStyles: Record<SetupPanelStatus, string> = {
  connected: "bg-emerald-400/15 text-emerald-300",
  connecting: "bg-amber-400/15 text-amber-300",
  disconnected: "bg-white/5 text-slate-400",
  error: "bg-rose-400/15 text-rose-300",
  loading: "bg-white/5 text-slate-400",
};

export function SetupPanelHeader({
  title,
  description,
  status,
  closeLabel,
  headingId,
  onClose,
}: {
  title: string;
  description: string;
  status: SetupPanelStatus;
  closeLabel: string;
  headingId?: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">
          Production setup
        </p>
        <h2 className="mt-1 text-lg font-semibold text-slate-100" id={headingId}>
          {title}
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">{description}</p>
      </div>
      <div className="flex items-start gap-3">
        <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${statusStyles[status]}`}>
          {status}
        </span>
        {onClose && (
          <button
            aria-label={closeLabel}
            className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-lg leading-none text-slate-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
            onClick={onClose}
            title="Close"
            type="button"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
