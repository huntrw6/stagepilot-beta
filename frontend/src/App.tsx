import { Dashboard } from "./components/Dashboard";
import { useStagePilot } from "./hooks/useStagePilot";

export default function App() {
  const stagePilot = useStagePilot();

  if (!stagePilot.state) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <div className="mx-auto grid h-12 w-12 animate-pulse place-items-center rounded-xl bg-sky-400/10 font-black text-sky-300">SP</div>
          <h1 className="mt-5 text-2xl font-bold text-white">Connecting to StagePilot</h1>
          <p className="mt-2 text-sm text-slate-500">Start the local backend on port 8765.</p>
          {stagePilot.error && <p className="mt-4 text-sm text-rose-300">{stagePilot.error}</p>}
        </div>
      </main>
    );
  }

  return <Dashboard {...stagePilot} state={stagePilot.state} />;
}
