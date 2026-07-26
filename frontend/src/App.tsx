import { useEffect, useState } from "react";

import { Dashboard } from "./components/Dashboard";
import { DesktopTitleBar } from "./components/DesktopTitleBar";
import {
  desktopBackendStatus,
  listenForDesktopBackend,
  type BackendSupervisorStatus,
} from "./desktop";
import { useStagePilot } from "./hooks/useStagePilot";
import { loadingProgressTarget } from "./loadingProgress";

export default function App() {
  const stagePilot = useStagePilot();
  const [backendSupervisor, setBackendSupervisor] = useState<BackendSupervisorStatus | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(1);
  const [dashboardVisible, setDashboardVisible] = useState(false);

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

  useEffect(() => {
    if (stagePilot.state) return;
    const target = loadingProgressTarget(backendSupervisor?.state ?? null);
    const interval = window.setInterval(() => {
      setLoadingProgress((current) => {
        if (current >= target) return current;
        return Math.min(target, current + Math.max(1, Math.ceil((target - current) / 9)));
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, [backendSupervisor?.state, stagePilot.state]);

  useEffect(() => {
    if (!stagePilot.state || dashboardVisible) return;
    const complete = window.setTimeout(() => setLoadingProgress(100), 0);
    const reveal = window.setTimeout(() => setDashboardVisible(true), 350);
    return () => {
      window.clearTimeout(complete);
      window.clearTimeout(reveal);
    };
  }, [dashboardVisible, stagePilot.state]);

  if (!stagePilot.state || !dashboardVisible) {
    return (
      <>
        <DesktopTitleBar />
        <main className="grid min-h-[calc(100vh-2.25rem)] place-items-center px-6 text-center">
          <div className="w-full max-w-4xl">
            <h1 className="font-brand text-[11.25rem] leading-none text-white">StagePilot</h1>
            <div
              aria-label="StagePilot startup progress"
              aria-valuemax={100}
              aria-valuemin={1}
              aria-valuenow={loadingProgress}
              className="loading-progress-track mx-auto mt-10 w-full max-w-xl"
              role="progressbar"
            >
              <div
                className="loading-progress-fill"
                style={{ width: `${loadingProgress}%` }}
              >
                <span className="loading-progress-scan" />
              </div>
            </div>
            <p className="mt-6 text-lg font-semibold text-white">Connecting to the local backend</p>
            <p className={`mt-2 text-sm ${backendSupervisor?.state === "failed" ? "text-rose-300" : "text-slate-400"}`}>
              {stagePilot.state
                ? "Dashboard ready."
                : backendSupervisor?.message ?? "Waiting for the StagePilot backend."}
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
