import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccessContext } from "../access/AccessContext";
import { DESKTOP_ACCESS } from "../access/accessState";
import * as api from "../api";
import * as desktop from "../desktop";
import { RemoteAccessPanel } from "./RemoteAccessPanel";

vi.mock("../api", async (original) => ({
  ...await original<typeof import("../api")>(),
  getRemoteStatus: vi.fn(), getRemoteUsers: vi.fn(), setRemoteEnabled: vi.fn(),
  bootstrapRemote: vi.fn(), createRemoteUser: vi.fn(),
  updateRemoteUser: vi.fn(), deleteRemoteUser: vi.fn(), regenerateRemote: vi.fn(),
}));
vi.mock("../desktop", async (original) => ({
  ...await original<typeof import("../desktop")>(),
  setRemoteAutostart: vi.fn(),
}));
const off: api.RemoteStatus = {available: true, provisioned: true, credential_available: true, enabled: false, state: "off", url: null, needs_operator: true, message: null, temporary_url: true};
const operator: api.RemoteUser = {id: "one", email: "operator@example.test", role: "Operator", enabled: true};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getRemoteStatus).mockResolvedValue(off);
  vi.mocked(api.getRemoteUsers).mockResolvedValue([]);
  vi.mocked(desktop.setRemoteAutostart).mockResolvedValue();
});

describe("Remote Access", () => {
  it("locally bootstraps Operator before enabling and clears password", async () => {
    vi.mocked(api.bootstrapRemote).mockResolvedValue(operator);
    vi.mocked(api.setRemoteEnabled).mockResolvedValue({...off, enabled: true, state: "enabling", needs_operator: false});
    render(<RemoteAccessPanel />);
    await waitFor(() => expect(screen.getByRole("button", {name: "Enable Remote Access"})).toBeEnabled());
    fireEvent.click(screen.getByRole("button", {name: "Enable Remote Access"}));
    fireEvent.change(screen.getByLabelText("Email"), {target: {value: operator.email}});
    fireEvent.change(screen.getByLabelText("Password"), {target: {value: "long-test-password"}});
    fireEvent.click(screen.getByRole("button", {name: "Create Operator and enable"}));
    await waitFor(() => expect(api.setRemoteEnabled).toHaveBeenCalledWith(true));
    expect(api.bootstrapRemote).toHaveBeenCalledWith(operator.email, "long-test-password");
    expect(vi.mocked(api.bootstrapRemote)).toHaveBeenCalledBefore(vi.mocked(api.setRemoteEnabled));
    expect(desktop.setRemoteAutostart).toHaveBeenCalledWith(true);
  });

  it("allows first use to enroll transparently while enabling", async () => {
    const unprovisioned = {...off, provisioned: false, credential_available: false};
    vi.mocked(api.getRemoteStatus).mockResolvedValue(unprovisioned);
    render(<RemoteAccessPanel />);

    expect(await screen.findByRole("button", {name: "Enable Remote Access"})).toBeEnabled();
    expect(screen.queryByText(/friend bundle/i)).not.toBeInTheDocument();
  });

  it("blocks enable when the native installation credential is unavailable", async () => {
    vi.mocked(api.getRemoteStatus).mockResolvedValue({...off, credential_available: false});
    render(<RemoteAccessPanel />);

    expect(await screen.findByText(/credential is unavailable or revoked/)).toBeInTheDocument();
    expect(screen.getByRole("button", {name: "Enable Remote Access"})).toBeDisabled();
    expect(screen.queryByRole("button", {name: /Import/})).not.toBeInTheDocument();
  });

  it("shows only safe connected URL and protects last Operator", async () => {
    vi.mocked(api.getRemoteStatus).mockResolvedValue({...off, enabled: true, state: "connected", needs_operator: false, url: "https://test.trycloudflare.com"});
    vi.mocked(api.getRemoteUsers).mockResolvedValue([operator]);
    render(<RemoteAccessPanel />);
    expect(await screen.findByLabelText("Remote URL")).toHaveTextContent("https://test.trycloudflare.com");
    expect(screen.getByText(/Temporary Remote link/)).toBeInTheDocument();
    expect(screen.getByRole("button", {name: `Delete ${operator.email}`})).toBeDisabled();
    expect(screen.getByRole("combobox", {name: `Role for ${operator.email}`})).toBeDisabled();
    fireEvent.click(screen.getByRole("button", {name: "Disable Remote Access"}));
    expect(api.setRemoteEnabled).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "Confirm disable"}));
    await waitFor(() => expect(api.setRemoteEnabled).toHaveBeenCalledWith(false));
    expect(desktop.setRemoteAutostart).toHaveBeenCalledWith(false);
  });

  it("shows a stable-link label for named Remote", async () => {
    vi.mocked(api.getRemoteStatus).mockResolvedValue({...off, enabled: true, state: "connected", needs_operator: false, url: "https://remote.example.test", temporary_url: false});
    render(<RemoteAccessPanel />);
    expect(await screen.findByText(/Stable Remote link/)).toBeInTheDocument();
    expect(screen.queryByText(/Temporary Remote link/)).not.toBeInTheDocument();
  });

  it("confirms password replacement and explains last-Operator protection", async () => {
    vi.mocked(api.getRemoteStatus).mockResolvedValue({...off, needs_operator: false});
    vi.mocked(api.getRemoteUsers).mockResolvedValue([operator]);
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<RemoteAccessPanel />);
    expect(await screen.findByText(/Last Operator protection is active/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {name: `Change password for ${operator.email}`}));
    fireEvent.change(screen.getByLabelText(`New password for ${operator.email}`), {target: {value: "replacement-password"}});
    fireEvent.click(screen.getByRole("button", {name: "Save password"}));
    expect(api.updateRemoteUser).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", {name: "Save password"}));
    await waitFor(() => expect(api.updateRemoteUser).toHaveBeenCalledWith(operator.id, {password: "replacement-password"}));
  });

  it("renders deliberate Viewer read-only without admin requests", () => {
    render(<AccessContext.Provider value={{...DESKTOP_ACCESS, mode: "remote", capabilities: {...DESKTOP_ACCESS.capabilities, canConfigure: false, canOperate: false}}}>
      <RemoteAccessPanel />
    </AccessContext.Provider>);
    expect(screen.getByText(/Read-only access/)).toBeInTheDocument();
    expect(api.getRemoteStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", {name: "Enable Remote Access"})).not.toBeInTheDocument();
  });

  it("hides unsafe links and raw infrastructure errors", async () => {
    vi.mocked(api.getRemoteStatus).mockResolvedValue({...off, enabled: true, state: "connected", url: "javascript:alert(1)", needs_operator: false});
    vi.mocked(api.getRemoteUsers).mockRejectedValue(new Error("private /database/provider error"));
    render(<RemoteAccessPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Local StagePilot is unaffected");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/private \/database/)).not.toBeInTheDocument();
  });

  it("regenerate asks for confirmation; cancel makes no changes; confirm calls the API", async () => {
    vi.mocked(api.getRemoteStatus).mockResolvedValue({...off, enabled: true, state: "connected", needs_operator: false, url: "https://test.trycloudflare.com"});
    vi.mocked(api.regenerateRemote).mockResolvedValue({...off, enabled: true, state: "connected", needs_operator: false, url: "https://test2.trycloudflare.com"});
    render(<RemoteAccessPanel />);
    expect(await screen.findByRole("button", {name: "Regenerate Remote link"})).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Regenerate Remote link"}));
    expect(await screen.findByRole("group", {name: "Confirm regenerate Remote link"})).toBeInTheDocument();
    expect(screen.getByText(/stop working/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Cancel"}));
    expect(api.regenerateRemote).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", {name: "Confirm regenerate Remote link"})).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Regenerate Remote link"}));
    fireEvent.click(screen.getByRole("button", {name: "Confirm regenerate"}));
    await waitFor(() => expect(api.regenerateRemote).toHaveBeenCalledTimes(1));
  });

  it("shows an in-button loading state during regenerate, disables the button, and blocks concurrent clicks", async () => {
    vi.mocked(api.getRemoteStatus).mockResolvedValue({...off, enabled: true, state: "connected", needs_operator: false, url: "https://test.trycloudflare.com"});
    let resolveRegenerate!: (value: api.RemoteStatus) => void;
    vi.mocked(api.regenerateRemote).mockReturnValue(new Promise((resolve) => { resolveRegenerate = resolve; }));
    render(<RemoteAccessPanel />);
    expect(await screen.findByRole("button", {name: "Regenerate Remote link"})).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Regenerate Remote link"}));
    fireEvent.click(screen.getByRole("button", {name: "Confirm regenerate"}));

    const busyButton = await screen.findByRole("button", {name: /Regenerating…/});
    expect(busyButton).toBeDisabled();

    // A second click while in flight must never trigger a second call
    // (there is no visible confirm dialog anymore, but clicking the busy
    // button itself must be a no-op).
    fireEvent.click(busyButton);
    expect(api.regenerateRemote).toHaveBeenCalledTimes(1);

    resolveRegenerate({...off, enabled: true, state: "connected", needs_operator: false, url: "https://test2.trycloudflare.com"});
    await waitFor(() => expect(screen.queryByRole("button", {name: /Regenerating…/})).not.toBeInTheDocument());
    expect(await screen.findByRole("button", {name: "Regenerate Remote link"})).toBeEnabled();
  });

  it("restores normal state and surfaces an error when regenerate fails", async () => {
    vi.mocked(api.getRemoteStatus).mockResolvedValue({...off, enabled: true, state: "connected", needs_operator: false, url: "https://test.trycloudflare.com"});
    vi.mocked(api.regenerateRemote).mockRejectedValue(new Error("provider unavailable"));
    render(<RemoteAccessPanel />);
    expect(await screen.findByRole("button", {name: "Regenerate Remote link"})).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {name: "Regenerate Remote link"}));
    fireEvent.click(screen.getByRole("button", {name: "Confirm regenerate"}));

    expect(await screen.findByRole("alert")).toHaveTextContent("Local StagePilot is unaffected");
    expect(await screen.findByRole("button", {name: "Regenerate Remote link"})).toBeEnabled();
    expect(screen.queryByRole("button", {name: /Regenerating…/})).not.toBeInTheDocument();
  });
});
