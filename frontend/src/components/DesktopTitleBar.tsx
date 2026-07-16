import {
  closeDesktopWindow,
  isDesktopShell,
  minimizeDesktopWindow,
  toggleMaximizeDesktopWindow,
} from "../desktop";

const runWindowAction = (action: () => Promise<void>) => {
  void action().catch(() => undefined);
};

export function DesktopTitleBar() {
  if (!isDesktopShell()) return null;

  return (
    <div
      aria-label="Window controls"
      className="sticky top-0 z-[100] h-9 select-none"
      data-tauri-drag-region
      onDoubleClick={() => runWindowAction(toggleMaximizeDesktopWindow)}
    >
      <div className="absolute inset-y-0 right-0 flex" onDoubleClick={(event) => event.stopPropagation()}>
        <button
          aria-label="Minimize window"
          className="grid h-9 w-12 place-items-center text-lg leading-none text-white/80 transition hover:bg-black/35 hover:text-white"
          onClick={() => runWindowAction(minimizeDesktopWindow)}
          type="button"
        >
          <span className="-translate-y-1" aria-hidden="true">−</span>
        </button>
        <button
          aria-label="Maximize or restore window"
          className="grid h-9 w-12 place-items-center text-white/80 transition hover:bg-black/35 hover:text-white"
          onClick={() => runWindowAction(toggleMaximizeDesktopWindow)}
          type="button"
        >
          <span aria-hidden="true" className="h-3 w-3 border border-current" />
        </button>
        <button
          aria-label="Close window"
          className="grid h-9 w-12 place-items-center text-xl leading-none text-white/80 transition hover:bg-red-600 hover:text-white"
          onClick={() => runWindowAction(closeDesktopWindow)}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </div>
  );
}
