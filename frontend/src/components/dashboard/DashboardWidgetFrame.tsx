import type { ReactNode } from "react";

import type { DashboardItemId } from "./dashboardLayoutTypes";

export function DashboardWidgetFrame({
  children,
  editing,
  first,
  id,
  label,
  last,
  onMove,
}: {
  children: ReactNode;
  editing: boolean;
  first: boolean;
  id: DashboardItemId;
  label: string;
  last: boolean;
  onMove: (id: DashboardItemId, offset: -1 | 1) => void;
}) {
  return (
    <div className={`dashboard-widget-frame relative h-full min-h-0 ${editing ? "rounded-xl ring-1 ring-[#ff6238]/40" : ""}`}>
      {editing && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border border-white/10 bg-slate-950/90 p-1 shadow-lg">
          <button
            aria-label={`Move ${label} earlier`}
            className="grid h-7 w-7 place-items-center rounded text-sm text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-25"
            disabled={first}
            onClick={() => onMove(id, -1)}
            title={`Move ${label} earlier`}
            type="button"
          >
            ←
          </button>
          <button
            aria-label={`Drag ${label} to a new dashboard position`}
            className="dashboard-widget-handle flex h-7 cursor-grab touch-none select-none items-center gap-1 rounded px-2 text-[0.65rem] font-bold uppercase tracking-wider text-[#ff9b7e] hover:bg-white/10 active:cursor-grabbing"
            title={`Drag ${label} to a new dashboard position`}
            type="button"
          >
            <span aria-hidden="true" className="text-base leading-none">⠿</span>
            Move
          </button>
          <button
            aria-label={`Move ${label} later`}
            className="grid h-7 w-7 place-items-center rounded text-sm text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-25"
            disabled={last}
            onClick={() => onMove(id, 1)}
            title={`Move ${label} later`}
            type="button"
          >
            →
          </button>
        </div>
      )}
      <div className="h-full min-h-0">{children}</div>
    </div>
  );
}
