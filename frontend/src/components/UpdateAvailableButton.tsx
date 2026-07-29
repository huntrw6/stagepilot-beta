import { forwardRef } from "react";

export const UpdateAvailableButton = forwardRef<HTMLButtonElement, {
  version: string;
  onClick: () => void;
}>(({ version, onClick }, ref) => (
  <button
    aria-label={`Update StagePilot to version ${version}`}
    className="ml-5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-sky-300/35 bg-sky-300/10 px-2.5 py-1.5 text-xs font-bold text-sky-100 transition-colors hover:bg-sky-300/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
    onClick={onClick}
    ref={ref}
    title={`StagePilot ${version} is available`}
    type="button"
  >
    <svg aria-hidden="true" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
    Update
  </button>
));

UpdateAvailableButton.displayName = "UpdateAvailableButton";
