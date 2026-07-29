import { useEffect, useRef } from "react";

export function DashboardResetDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelButton.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel, open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4">
      <div aria-labelledby="dashboard-reset-heading" aria-modal="true" className="w-full max-w-md rounded-2xl border border-rose-400/25 bg-slate-950 p-5 shadow-2xl" role="dialog">
        <h2 className="text-lg font-bold text-white" id="dashboard-reset-heading">Reset dashboard layout?</h2>
        <p className="mt-2 text-sm text-slate-300">
          This removes custom positions, sizes, and spacers. Other StagePilot settings are unchanged.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelButton} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/10" onClick={onCancel} type="button">Cancel</button>
          <button className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-bold text-white hover:bg-rose-400" onClick={onConfirm} type="button">Reset layout</button>
        </div>
      </div>
    </div>
  );
}
