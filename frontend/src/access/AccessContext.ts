import { createContext, useContext } from "react";

import { DESKTOP_ACCESS } from "./accessState";
import type { DashboardAccess } from "../types";

export const AccessContext = createContext<DashboardAccess>(DESKTOP_ACCESS);
export const useDashboardAccess = () => useContext(AccessContext);
