import { useEffect, useState } from "react";

import { Dashboard } from "./components/Dashboard";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import {
  desktopBackendStatus,
  listenForDesktopBackend,
  type BackendSupervisorStatus,
} from "./desktop";
import { useStagePilot } from "./hooks/useStagePilot";

export default function App() {
  const stagePilot = useStagePilot();
  const [backendSupervisor, setBackendSupervisor] = useState<BackendSupervisorStatus | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;
    void desktopBackendStatus()
      .then((status) => {
        if (active && status) setBackendSupervisor(status);
      })
      .catch(() => undefined);
    void listenForDesktopBackend((status) => {
      if (active) setBackendSupervisor(status);
    }).then((nextUnlisten) => {
      if (!active) nextUnlisten?.();
      else unlisten = nextUnlisten;
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  if (!stagePilot.state) {
    return (
      <>
        <DesktopTitleBar />
        <main className="grid min-h-[calc(100vh-2.25rem)] place-items-center px-6 text-center">
          <div>
            <h1 className="font-brand text-[11.25rem] leading-none text-white">StagePilot</h1>
            <p className="mt-12 text-lg font-semibold text-white">Connecting to the local backend</p>
            <p className={`mt-2 text-sm ${backendSupervisor?.state === "failed" ? "text-rose-300" : "text-slate-400"}`}>
              {backendSupervisor?.message ?? "Waiting for the StagePilot backend."}
            </p>
            {stagePilot.error && <p className="mt-4 text-sm text-rose-300">{stagePilot.error}</p>}
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <DesktopTitleBar />
      <Dashboard {...stagePilot} state={stagePilot.state} />
    </>
  );
}
