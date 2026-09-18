import { useEffect, useRef, useState, type FormEvent } from "react";
import { useDashboardAccess } from "../access/AccessContext";
import { invalidateAccess } from "../access/accessState";
import {
  ApiError, bootstrapRemote, createRemoteUser, deleteRemoteUser, getRemoteStatus,
  getRemoteUsers, regenerateRemote, setRemoteEnabled, updateRemoteUser,
  type RemoteStatus, type RemoteUser,
} from "../api";
import { setRemoteAutostart } from "../desktop";

const button = "rounded-lg border border-white/20 px-3.5 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-40";
const primaryButton = "rounded-lg border border-rose-400/40 bg-rose-500 px-3.5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-400 disabled:opacity-40";
const input = "w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100 outline-none focus:border-rose-400/50";
const labels: Record<RemoteStatus["state"], string> = {
  off: "Off", enabling: "Enabling…", connected: "Connected", reconnecting: "Reconnecting…", error: "Connection unavailable",
};

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port
      && parsed.pathname === "/" && !parsed.search && !parsed.hash ? value : null;
  } catch { return null; }
}

function friendlyError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401 || cause.status === 403) return "Your access has changed. Please sign in again.";
    if (cause.status === 409) return "The change could not be applied. Keep at least one enabled Operator and use a unique email. Refresh before trying again.";
    if (cause.status === 422) return "Use a valid email and a password of at least 12 characters.";
    if (cause.status === 429) return "Too many requests. Please wait before trying again.";
  }
  return "Remote Access is unavailable. Local StagePilot is unaffected. Try again shortly.";
}

export function RemoteAccessPanel() {
  const access = useDashboardAccess();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [users, setUsers] = useState<RemoteUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bootstrap, setBootstrap] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<RemoteUser["role"]>("Viewer");
  const [edit, setEdit] = useState<RemoteUser | null>(null);
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const canManage = access.authenticated && access.capabilities.canConfigure;
  const local = access.mode !== "remote";

  useEffect(() => {
    alive.current = true;
    if (!canManage) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!inFlight.current) {
        try {
          const next = await getRemoteStatus();
          if (!cancelled) setStatus(next);
        } catch (cause) {
          if (!cancelled) { setStatus(null); setError(friendlyError(cause)); }
        }
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    void getRemoteUsers().then((next) => { if (!cancelled) setUsers(next); }).catch((cause) => {
      if (!cancelled) setError(friendlyError(cause));
    });
    return () => { cancelled = true; alive.current = false; clearTimeout(timer); };
  }, [canManage]);

  async function run(work: () => Promise<unknown>, selfChange = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setError(null); setNotice(null);
    try {
      await work();
      if (selfChange && !local) { invalidateAccess(); return; }
      const [next, nextUsers] = await Promise.all([getRemoteStatus(), getRemoteUsers()]);
      if (alive.current) { setStatus(next); setUsers(nextUsers); setNotice("Changes saved."); }
    } catch (cause) {
      if (alive.current) setError(friendlyError(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) { setBusy(false); setPassword(""); }
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (edit && !window.confirm(`Replace the password for ${edit.email} and revoke all of their Remote sessions?`)) return;
    void run(async () => {
      if (bootstrap) {
        await bootstrapRemote(email, password);
        setBootstrap(false); setEmail("");
        await setRemoteEnabled(true);
        await setRemoteAutostart(true);
      } else if (edit) {
        await updateRemoteUser(edit.id, {password}); setEdit(null);
      } else {
        await createRemoteUser(email, password, role); setEmail("");
      }
    }, edit?.email === access.user?.email);
  };
  const url = status?.state === "connected" ? safeUrl(status.url) : null;
  const operators = users.filter((user) => user.enabled && user.role === "Operator").length;
  if (!canManage) return <div aria-label="Remote Access"><p className="text-sm text-slate-300">Read-only access. An Operator manages Remote Access.</p></div>;

  return <div aria-label="Remote Access" className="space-y-4">
    <p className="text-sm text-slate-300">Securely view or operate this StagePilot from another device. Local operation continues if Remote disconnects.</p>
    <p role="status" className="text-sm text-sky-200">{status ? labels[status.state] : "Checking Remote Access…"}</p>
    {status?.temporary_url ?
      <p className="text-sm text-amber-200">Temporary Remote link: the address changes after reconnection or restart. This preview is not a permanent remote address.</p> :
      <p className="text-sm text-sky-200">Stable Remote link: this installation keeps the same address after reconnecting.</p>}
    {status && !status.available && <p className="text-sm text-slate-300">Remote Access is unavailable on this installation. Local StagePilot is unaffected.</p>}
    {status?.provisioned && !status.credential_available && <p className="text-sm text-amber-200">The installation credential is unavailable or revoked. Remote remains off; contact beta support to recover this installation.</p>}
    {status?.state === "error" && <p className="text-sm text-slate-300">Check your Internet connection. You can disable Remote and try enabling it again.</p>}
    {status?.state === "reconnecting" && <p className="text-sm text-slate-300">Reconnecting. Check here for the current link once connected.</p>}

    {url && <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-3">
      <output aria-label="Remote URL" className="break-all text-sm text-sky-200">{url}</output>
      <button className={button} type="button" onClick={() => {
        if (!navigator.clipboard) { setError("Copy unavailable. Select and copy the link above."); return; }
        void navigator.clipboard.writeText(url).then(() => setNotice("Link copied."), () => setError("Copy unavailable. Select and copy the link above."));
      }}>Copy link</button>
      <button className={button} disabled={busy} type="button" onClick={() => setConfirmRegenerate(true)}>Regenerate Remote link</button>
      {!status?.enabled ? null : <button className={button} disabled={busy} type="button" onClick={() => setConfirmDisable(true)}>Disable Remote Access</button>}
    </div>}
    {confirmRegenerate && <div role="group" aria-label="Confirm regenerate Remote link" className="space-y-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3">
      <p className="text-sm text-amber-200">
        The current Remote link will stop working. Anyone using the old address will lose access. Continue?
      </p>
      <div className="flex flex-wrap gap-3">
        <button className={primaryButton} disabled={busy} type="button" onClick={() => {
          setConfirmRegenerate(false);
          void run(async () => { await regenerateRemote(); });
        }}>Confirm regenerate</button>
        <button className={button} type="button" onClick={() => setConfirmRegenerate(false)}>Cancel</button>
      </div>
    </div>}
    {!url && !status?.enabled && <button className={primaryButton} disabled={busy || !status?.available || Boolean(status?.provisioned && !status?.credential_available)} type="button" onClick={() => {
      if (status?.needs_operator) { if (local) setBootstrap(true); }
      else void run(async () => { await setRemoteEnabled(true); await setRemoteAutostart(true); });
    }}>Enable Remote Access</button>}
    {!url && status?.enabled && <button className={button} disabled={busy} type="button" onClick={() => setConfirmDisable(true)}>Disable Remote Access</button>}
    {confirmDisable && <div role="group" aria-label="Confirm disable Remote Access" className="space-y-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3">
      <p className="text-sm text-amber-200">Disconnect all Remote users? Local StagePilot will keep running.</p>
      <div className="flex flex-wrap gap-3">
        <button className={primaryButton} disabled={busy} type="button" onClick={() => {
          setConfirmDisable(false); void run(async () => {
            await setRemoteEnabled(false); await setRemoteAutostart(false);
          }, true);
        }}>Confirm disable</button>
        <button className={button} type="button" onClick={() => setConfirmDisable(false)}>Cancel</button>
      </div>
    </div>}
    {status?.needs_operator && !local && <p className="text-sm text-slate-300">Create the first Operator from local StagePilot.</p>}
    {bootstrap && local && <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Create first Operator</h3>}
    {(bootstrap && local || status && !status.needs_operator) && <>
      {!bootstrap && <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Remote users</h3>}
      <p className="text-sm text-slate-300">Viewers are read-only. Operators can control StagePilot and manage users. Keep at least one enabled Operator. User changes revoke that user's sessions.</p>
      {!bootstrap && <ul className="space-y-3">{users.map((user) => {
        const last = user.enabled && user.role === "Operator" && operators <= 1;
        const self = user.email === access.user?.email;
        return <li key={user.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-3 text-sm text-slate-300">
          <span className="text-sm text-slate-200">{user.email} · {user.enabled ? "Enabled" : "Disabled"}{last ? " · Last Operator" : ""}</span>
          <label className="text-sm text-slate-300">Role for {user.email} <select className="ml-1 rounded-lg border border-white/10 bg-slate-950 px-2 py-1.5 text-slate-100" value={user.role} disabled={busy || last}
            onChange={(event) => {
              const nextRole = event.target.value as RemoteUser["role"];
              if (user.role === "Operator" && nextRole === "Viewer" && !window.confirm(`Change ${user.email} to Viewer and revoke their Remote sessions?`)) return;
              void run(() => updateRemoteUser(user.id, {role: nextRole}), self);
            }}>
            <option>Viewer</option><option>Operator</option></select></label>
          <button className={button} disabled={busy || last} type="button" onClick={() => {
            if (user.enabled && !window.confirm(`Disable ${user.email} and revoke their Remote sessions?`)) return;
            void run(() => updateRemoteUser(user.id, {enabled: !user.enabled}), self);
          }}>{user.enabled ? "Disable" : "Enable"} {user.email}</button>
          <button className={button} disabled={busy} type="button" onClick={() => {setEdit(user); setPassword("");}}>Change password for {user.email}</button>
          <button className={button} disabled={busy || last} type="button" onClick={() => {
            if (window.confirm(`Delete ${user.email} and revoke their sessions?`)) void run(() => deleteRemoteUser(user.id), self);
          }}>Delete {user.email}</button>
        </li>;
      })}</ul>}
      {operators === 1 && <p className="text-sm text-amber-200">Last Operator protection is active. Add or enable another Operator before changing or deleting the remaining Operator.</p>}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        {!edit && <label className="grid gap-1 text-sm text-slate-300">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Email</span>
          <input className={input} type="email" autoComplete="off" required maxLength={254} disabled={busy} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>}
        <label className="grid gap-1 text-sm text-slate-300">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{edit ? `New password for ${edit.email}` : "Password"}</span>
          <input className={input} type="password" autoComplete="new-password" required minLength={12} maxLength={1024} disabled={busy} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {!edit && !bootstrap && <label className="grid gap-1 text-sm text-slate-300">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">New user role</span>
          <select className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2.5 text-slate-100" disabled={busy} value={role} onChange={(e) => setRole(e.target.value as RemoteUser["role"])}><option>Viewer</option><option>Operator</option></select>
        </label>}
        <button className={primaryButton} disabled={busy} type="submit">{bootstrap ? "Create Operator and enable" : edit ? "Save password" : "Add user"}</button>
        {(edit || bootstrap) && <button className={button} type="button" onClick={() => {setEdit(null); setBootstrap(false); setPassword("");}}>Cancel</button>}
      </form>
    </>}
    {notice && <p role="status" className="text-sm text-sky-200">{notice}</p>}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
  </div>;
}
