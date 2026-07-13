import { useCallback, useEffect, useRef, useState } from "react";

import {
  getHealth,
  getMidiInputs,
  getMidiMessages,
  getState,
  performAction,
  refreshMidiInputs,
  selectMidiInput,
  selectPlanningCenterPlan,
  simulateMidiCue,
  websocketUrl,
} from "../api";
import type {
  ActionName,
  ApplicationState,
  ConnectionStatus,
  HealthResponse,
  MidiCueName,
  MidiInputsResponse,
  MidiMonitorMessage,
  StateEnvelope,
} from "../types";

const MAX_RECONNECT_DELAY = 10_000;
const MIDI_MONITOR_INTERVAL = 750;

export function useStagePilot() {
  const [state, setState] = useState<ApplicationState | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionName | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);
  const [midi, setMidi] = useState<MidiInputsResponse | null>(null);
  const [midiMessages, setMidiMessages] = useState<MidiMonitorMessage[]>([]);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiMessage, setMidiMessage] = useState<string | null>(null);
  const [pendingMidiOperation, setPendingMidiOperation] = useState<
    "refresh" | "connect" | "disconnect" | null
  >(null);
  const [pendingMidiCue, setPendingMidiCue] = useState<MidiCueName | null>(null);
  const reconnectAttempts = useRef(0);
  const previousMidiStatus = useRef<ConnectionStatus | null>(null);

  const applyState = useCallback((nextState: ApplicationState) => {
    setState((currentState) =>
      currentState === null || nextState.revision >= currentState.revision
        ? nextState
        : currentState,
    );
  }, []);

  const loadMidiInputs = useCallback(async () => {
    try {
      const response = await getMidiInputs();
      setMidi(response);
      setMidiError(null);
    } catch (cause) {
      setMidiError(cause instanceof Error ? cause.message : "MIDI inputs unavailable.");
    }
  }, []);

  const loadMidiMessages = useCallback(async () => {
    try {
      setMidiMessages((await getMidiMessages()).messages);
    } catch {
      // Input selection and cue actions remain usable if the monitor refresh fails.
    }
  }, []);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;

    const refresh = async () => {
      try {
        const [nextHealth, nextState] = await Promise.all([getHealth(), getState()]);
        if (!active) return;
        setHealth(nextHealth);
        applyState(nextState);
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
          if (envelope.type === "state.snapshot") applyState(envelope.data);
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
    void loadMidiInputs();
    void loadMidiMessages();
    connect();
    return () => {
      active = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [applyState, loadMidiInputs, loadMidiMessages]);

  useEffect(() => {
    if (!midi?.enabled) return;
    const timer = window.setInterval(() => {
      void loadMidiMessages();
    }, MIDI_MONITOR_INTERVAL);
    return () => window.clearInterval(timer);
  }, [loadMidiMessages, midi?.enabled]);

  useEffect(() => {
    const status = state?.midi_status;
    if (!status) return;
    if (previousMidiStatus.current === null) {
      previousMidiStatus.current = status;
      return;
    }
    if (previousMidiStatus.current === status) return;
    previousMidiStatus.current = status;
    void loadMidiInputs();
  }, [loadMidiInputs, state?.midi_status]);

  const dispatch = useCallback(async (action: ActionName) => {
    setPendingAction(action);
    setActionMessage(null);
    try {
      const response = await performAction(action);
      applyState(response.state);
      setActionMessage(response.message);
      if (!response.accepted) setError(response.message);
      else setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed.");
    } finally {
      setPendingAction(null);
    }
  }, [applyState]);

  const selectPlan = useCallback(async (planId: string) => {
    setPendingPlanId(planId);
    setActionMessage(null);
    try {
      const response = await selectPlanningCenterPlan(planId);
      applyState(response.state);
      setActionMessage(response.message);
      setError(response.accepted ? null : response.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Plan selection failed.");
    } finally {
      setPendingPlanId(null);
    }
  }, [applyState]);

  const refreshMidi = useCallback(async () => {
    setPendingMidiOperation("refresh");
    setMidiError(null);
    setMidiMessage(null);
    try {
      setMidi(await refreshMidiInputs());
      setMidiMessage("MIDI input list refreshed.");
    } catch (cause) {
      setMidiError(cause instanceof Error ? cause.message : "MIDI refresh failed.");
    } finally {
      setPendingMidiOperation(null);
    }
  }, []);

  const selectMidi = useCallback(async (inputId: string | null) => {
    setPendingMidiOperation(inputId === null ? "disconnect" : "connect");
    setMidiError(null);
    setMidiMessage(null);
    try {
      const response = await selectMidiInput(inputId);
      setMidi(response.midi);
      setMidiMessage(response.message);
      if (!response.accepted) setMidiError(response.message);
    } catch (cause) {
      setMidiError(cause instanceof Error ? cause.message : "MIDI input selection failed.");
    } finally {
      setPendingMidiOperation(null);
    }
  }, []);

  const simulateMidi = useCallback(async (cue: MidiCueName) => {
    setPendingMidiCue(cue);
    setMidiError(null);
    setMidiMessage(null);
    try {
      const response = await simulateMidiCue(cue);
      applyState(response.state);
      await loadMidiMessages();
      setMidiMessage(response.message);
      if (!response.accepted) setMidiError(response.message);
    } catch (cause) {
      setMidiError(cause instanceof Error ? cause.message : "MIDI cue simulation failed.");
    } finally {
      setPendingMidiCue(null);
    }
  }, [applyState, loadMidiMessages]);

  return {
    state,
    health,
    live,
    error,
    actionMessage,
    pendingAction,
    pendingPlanId,
    midi,
    midiMessages,
    midiError,
    midiMessage,
    pendingMidiOperation,
    pendingMidiCue,
    dispatch,
    selectPlan,
    refreshMidi,
    selectMidi,
    simulateMidi,
  };
}
