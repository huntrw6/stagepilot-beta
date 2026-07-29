import { useEffect, useRef } from "react";

import type { UpdaterState } from "../hooks/useUpdater";

const formatBytes = (bytes: number) => {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
};

export function UpdateDialog({
  updater,
  onCancel,
  onConfirm,
  onRetry,
  onCloseError,
  returnFocus,
}: {
  updater: UpdaterState;
  onCancel: () => void;
  onConfirm: () => void;
  onRetry: () => void;
  onCloseError: () => void;
  returnFocus: React.RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const active = ["confirmation", "downloading", "installing", "restarting"].includes(updater.status)
    || (updater.status === "error" && updater.errorDialogOpen);
  const locked = ["downloading", "installing", "restarting"].includes(updater.status);

  useEffect(() => {
    if (!active) return;
    (cancel.current ?? dialog.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !locked) {
        event.preventDefault();
        if (updater.status === "confirmation") onCancel();
        else if (updater.status === "error") onCloseError();
        returnFocus.current?.focus();
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled)")];
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, locked, onCancel, onCloseError, returnFocus, updater.status]);

  if (!active) return null;
  const progress = updater.progress;
  const stage = updater.status === "restarting"
    ? "Restarting StagePilot"
    : progress?.stage === "installing"
      ? "Installing update"
      : progress?.stage === "verifying"
        ? "Verifying signature"
        : progress?.stage === "downloading"
          ? "Downloading update"
          : "Preparing update";

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4" onMouseDown={(event) => event.stopPropagation()}>
      <div
        aria-labelledby="update-dialog-title"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-sky-300/20 bg-slate-950 p-6 shadow-2xl shadow-black/60"
        ref={dialog}
        role="dialog"
        tabIndex={-1}
      >
        {updater.status === "confirmation" ? (
          <>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-300">Update available</p>
            <h2 className="mt-1 text-2xl font-bold text-white" id="update-dialog-title">Update StagePilot?</h2>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-slate-400">Current</dt><dd className="font-mono text-slate-100">{updater.currentVersion}</dd>
              <dt className="text-slate-400">Available</dt><dd className="font-mono text-sky-200">{updater.availableVersion}</dd>
            </dl>
            <div className="mt-4 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
              {updater.releaseNotes ?? "No release notes were supplied for this update."}
            </div>
            <p className="mt-4 text-sm text-slate-400">StagePilot will install the signed update and restart automatically.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10" onClick={() => { onCancel(); returnFocus.current?.focus(); }} ref={cancel} type="button">Cancel</button>
              <button className="rounded-lg bg-sky-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-sky-200" onClick={onConfirm} type="button">Update and Restart</button>
            </div>
          </>
        ) : updater.status === "error" ? (
          <>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-rose-300">Update interrupted</p>
            <h2 className="mt-1 text-2xl font-bold text-white" id="update-dialog-title">StagePilot stayed open</h2>
            <p className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 text-sm text-rose-100">{updater.error ?? "The update could not be installed."}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10" onClick={onCloseError} ref={cancel} type="button">Close</button>
              <button className="rounded-lg bg-sky-300 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-sky-200" onClick={onRetry} type="button">Retry</button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-sky-300">Updating StagePilot</p>
            <h2 className="mt-1 text-2xl font-bold text-white" id="update-dialog-title">{stage}</h2>
            <div
              aria-label="Update progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={progress?.percentage ?? undefined}
              className="mt-5 h-3 overflow-hidden rounded-full border border-sky-300/20 bg-slate-900"
              role="progressbar"
            >
              <div
                className={`h-full rounded-full bg-sky-300 transition-[width] duration-200 ${progress?.percentage == null ? "w-1/3 animate-pulse" : ""}`}
                style={progress?.percentage == null ? undefined : { width: `${progress.percentage}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-slate-400">
              {progress
                ? `${formatBytes(progress.downloadedBytes)}${progress.totalBytes ? ` of ${formatBytes(progress.totalBytes)}` : " downloaded"}`
                : "Preparing the signed update package…"}
            </p>
            <p className="mt-2 text-xs text-slate-500">No further action is required. Do not quit StagePilot.</p>
          </>
        )}
      </div>
    </div>
  );
}
