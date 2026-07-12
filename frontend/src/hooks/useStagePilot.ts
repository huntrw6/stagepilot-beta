import { useCallback, useEffect, useRef, useState } from "react";

import { getHealth, getState, performAction, websocketUrl } from "../api";
import type {
  ActionName,
  ApplicationState,
  HealthResponse,
  StateEnvelope,
} from "../types";

const MAX_RECONNECT_DELAY = 10_000;

export function useStagePilot() {
  const [state, setState] = useState<ApplicationState | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionName | null>(null);
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    const refresh = async () => {
      try {
        const [nextHealth, nextState] = await Promise.all([getHealth(), getState()]);
        if (!active) return;
        setHealth(nextHealth);
        setState(nextState);
        setError(null);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Backend unavailable.");
      }
    };

    const connect = () => {
      if (!active) return;
      socket = new WebSocket(websocketUrl);
      socket.onopen = () => {
        reconnectAttempts.current = 0;
        setLive(true);
        setError(null);
        void refresh();
      };
      socket.onmessage = (message) => {
        try {
          const envelope = JSON.parse(String(message.data)) as StateEnvelope;
          if (envelope.type === "state.snapshot") setState(envelope.data);
        } catch {
          setError("Received an invalid live-state message.");
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (!active) return;
        setLive(false);
        setError("Live connection interrupted; reconnecting.");
        const delay = Math.min(1000 * 2 ** reconnectAttempts.current, MAX_RECONNECT_DELAY);
        reconnectAttempts.current += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    void refresh();
    connect();
    return () => {
      active = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  const dispatch = useCallback(async (action: ActionName) => {
    setPendingAction(action);
    setActionMessage(null);
    try {
      const response = await performAction(action);
      setState(response.state);
      setActionMessage(response.message);
      if (!response.accepted) setError(response.message);
      else setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed.");
    } finally {
      setPendingAction(null);
    }
  }, []);

  return { state, health, live, error, actionMessage, pendingAction, dispatch };
}
