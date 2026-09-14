import type { AccessCapabilities, DashboardAccess } from "../types";

export const LOCAL_CAPABILITIES: AccessCapabilities = {
  canRead: true, canOperate: true, canConfigure: true, canActivateServices: true,
};
export const NO_CAPABILITIES: AccessCapabilities = {
  canRead: false, canOperate: false, canConfigure: false, canActivateServices: false,
};
// Native shell startup must not wait for the sidecar's HTTP access discovery.
// The server still authorizes every request through its unchanged local path.
export const DESKTOP_ACCESS: DashboardAccess = {
  mode: "desktop", authentication: "none", authenticated: true,
  capabilities: LOCAL_CAPABILITIES, user: null, expires_at: null, csrf_token: null,
};

let current: DashboardAccess | null = null;
let generation = 0;
const listeners = new Set<() => void>();

export function setApiAccess(access: DashboardAccess | null) {
  current = access;
  generation += 1;
}
export const apiAccess = () => current;
export const accessGeneration = () => generation;
export function invalidateAccess(expectedGeneration = generation) {
  if (expectedGeneration !== generation) return;
  if (current) {
    current = { ...current, authenticated: false, capabilities: NO_CAPABILITIES, csrf_token: null };
  }
  generation += 1;
  listeners.forEach((listener) => listener());
}
export function onAccessInvalidated(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
