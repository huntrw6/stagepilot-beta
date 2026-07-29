import type { DashboardSpacerId } from "./dashboardLayoutTypes";

export function DashboardSpacer({
  editing,
  id,
  onRemove,
}: {
  editing: boolean;
  id: DashboardSpacerId;
  onRemove: (id: DashboardSpacerId) => void;
}) {
  if (!editing) {
    return <div aria-hidden="true" className="pointer-events-none h-full opacity-0" />;
  }
  return (
    <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-dashed border-sky-300/40 bg-sky-300/[0.06]">
      <div className="text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-sky-200">Intentional spacer</p>
        <button
          aria-label="Remove dashboard spacer"
          className="mt-2 rounded-md border border-rose-400/30 px-2.5 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-400/20"
          onClick={() => onRemove(id)}
          type="button"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
