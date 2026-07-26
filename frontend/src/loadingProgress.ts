import type { BackendSupervisorStatus } from "./desktop";

export const loadingProgressTarget = (
  status: BackendSupervisorStatus["state"] | null,
) => {
  switch (status) {
    case "starting":
      return 58;
    case "ready":
    case "external":
      return 92;
    case "failed":
    case "stopped":
      return 35;
    default:
      return 24;
  }
};
