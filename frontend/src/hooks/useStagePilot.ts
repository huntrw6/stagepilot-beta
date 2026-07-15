import { useCallback, useEffect, useRef, useState } from "react";

import {
  getHealth,
  getMidiInputs,
  getMidiMessages,
  getPlanningCenterServiceTypes,
  getPlanningCenterStatus,
  getProPresenterStatus,
  getSettings,
  getState,
  performAction,
  refreshMidiInputs,
  refreshProPresenterTimers,
  selectMidiInput,
  selectPlanningCenterPlan,
  simulateMidiCue,
  testPlanningCenter,
  testProPresenter,
  updatePlanningCenterSettings,
  updateProPresenterSettings,
  updateSettings,
  websocketUrl,
} from "../api";
import type {
  ActionName,
  ApplicationState,
  ConnectionStatus,
  HealthResponse,
  IntegrationModes,
  MidiCueName,
  MidiInputsResponse,
  MidiMonitorMessage,
  PlanningCenterServiceType,
  PlanningCenterSettingsInput,
  PlanningCenterStatusResponse,
  PlanningCenterTestInput,
  ProPresenterSettingsInput,
  ProPresenterStatusResponse,
  ServiceSource,
  SettingsResponse,
  StateEnvelope,
} from "../types";

const MAX_RECONNECT_DELAY = 10_000;
const MIDI_MONITOR_INTERVAL = 750;
const PROPRESENTER_MONITOR_INTERVAL = 3_000;

export function useStagePilot() {
  const [state, setState] = useState<ApplicationState | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ActionName | null>(null);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);

  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [pendingSettingsOperation, setPendingSettingsOperation] = useState(false);

  const [planningCenterStatus, setPlanningCenterStatus] =
    useState<PlanningCenterStatusResponse | null>(null);
  const [planningCenterServiceTypes, setPlanningCenterServiceTypes] = useState<
    PlanningCenterServiceType[]
  >([]);
  const [planningCenterError, setPlanningCenterError] = useState<string | null>(null);
  const [planningCenterMessage, setPlanningCenterMessage] = useState<string | null>(null);
  const [pendingPlanningCenterOperation, setPendingPlanningCenterOperation] = useState<
    "test" | "load-types" | "save" | null
  >(null);

  const [midi, setMidi] = useState<MidiInputsResponse | null>(null);
  const [midiMessages, setMidiMessages] = useState<MidiMonitorMessage[]>([]);
  const [midiError, setMidiError] = useState<string | null>(null);
  const [midiMessage, setMidiMessage] = useState<string | null>(null);
  const [pendingMidiOperation, setPendingMidiOperation] = useState<
    "refresh" | "connect" | "disconnect" | null
  >(null);
  const [pendingMidiCue, setPendingMidiCue] = useState<MidiCueName | null>(null);

  const [propresenter, setProPresenter] = useState<ProPresenterStatusResponse | null>(null);
  const [propresenterError, setProPresenterError] = useState<string | null>(null);
  const [propresenterMessage, setProPresenterMessage] = useState<string | null>(null);
  const [pendingProPresenterOperation, setPendingProPresenterOperation] = useState<
    "save" | "test" | "refresh" | null
  >(null);

  const reconnectAttempts = useRef(0);
  const previousMidiStatus = useRef<ConnectionStatus | null>(null);
  const previousProPresenterStatus = useRef<ConnectionStatus | null>(null);

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

  const loadProPresenter = useCallback(async () => {
    try {
      setProPresenter(await getProPresenterStatus());
      setProPresenterError(null);
    } catch (cause) {
      setProPresenterError(
        cause instanceof Error ? cause.message : "ProPresenter status unavailable.",
      );
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setSettings(await getSettings());
      setSettingsError(null);
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : "Settings unavailable.");
    }
  }, []);

  const loadPlanningCenterStatus = useCallback(async () => {
    try {
      setPlanningCenterStatus(await getPlanningCenterStatus());
      setPlanningCenterError(null);
    } catch (cause) {
      setPlanningCenterError(
        cause instanceof Error ? cause.message : "Planning Center status unavailable.",
      );
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
        if (active) {
          setError(cause instanceof Error ? cause.message : "Backend unavailable.");
        }
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
        const delay = Math.min(
          1000 * 2 ** reconnectAttempts.current,
          MAX_RECONNECT_DELAY,
        );
        reconnectAttempts.current += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    void refresh();
    void loadMidiInputs();
    void loadMidiMessages();
    void loadProPresenter();
    void loadSettings();
    void loadPlanningCenterStatus();
    connect();

    return () => {
      active = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [
    applyState,
    loadMidiInputs,
    loadMidiMessages,
    loadPlanningCenterStatus,
    loadProPresenter,
    loadSettings,
  ]);

  useEffect(() => {
    if (!midi?.enabled) return;
    const timer = window.setInterval(() => {
      void loadMidiMessages();
    }, MIDI_MONITOR_INTERVAL);
    return () => window.clearInterval(timer);
  }, [loadMidiMessages, midi?.enabled]);

  useEffect(() => {
    if (!propresenter?.enabled) return;
    const timer = window.setInterval(() => {
      void loadProPresenter();
    }, PROPRESENTER_MONITOR_INTERVAL);
    return () => window.clearInterval(timer);
  }, [loadProPresenter, propresenter?.enabled]);

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

  useEffect(() => {
    const status = state?.propresenter_status;
    if (!status) return;
    if (previousProPresenterStatus.current === null) {
      previousProPresenterStatus.current = status;
      return;
    }
    if (previousProPresenterStatus.current === status) return;
    previousProPresenterStatus.current = status;
    void loadProPresenter();
  }, [loadProPresenter, state?.propresenter_status]);

  const dispatch = useCallback(
    async (action: ActionName) => {
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
    },
    [applyState],
  );

  const selectPlan = useCallback(
    async (planId: string) => {
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
    },
    [applyState],
  );

  const saveIntegrationModes = useCallback(
    async (integrationModes: IntegrationModes) => {
      if (!settings) return;
      setPendingSettingsOperation(true);
      setSettingsError(null);
      setSettingsMessage(null);
      try {
        const response = await updateSettings({
          ...settings.settings,
          integration_modes: integrationModes,
        });
        setSettings(response);
        setSettingsMessage("Integration modes saved. Restart StagePilot to apply them.");
      } catch (cause) {
        setSettingsError(cause instanceof Error ? cause.message : "Settings update failed.");
      } finally {
        setPendingSettingsOperation(false);
      }
    },
    [settings],
  );

  const testPlanningCenterConnection = useCallback(
    async (input: PlanningCenterTestInput) => {
      setPendingPlanningCenterOperation("test");
      setPlanningCenterError(null);
      setPlanningCenterMessage(null);
      try {
        const response = await testPlanningCenter(input);
        setPlanningCenterServiceTypes(response.service_types);
        setPlanningCenterMessage(response.message);
      } catch (cause) {
        setPlanningCenterError(
          cause instanceof Error ? cause.message : "Planning Center connection test failed.",
        );
      } finally {
        setPendingPlanningCenterOperation(null);
      }
    },
    [],
  );

  const loadPlanningCenterServiceTypes = useCallback(async () => {
    setPendingPlanningCenterOperation("load-types");
    setPlanningCenterError(null);
    setPlanningCenterMessage(null);
    try {
      const serviceTypes = await getPlanningCenterServiceTypes();
      setPlanningCenterServiceTypes(serviceTypes);
      setPlanningCenterMessage(`Loaded ${serviceTypes.length} Planning Center service types.`);
    } catch (cause) {
      setPlanningCenterError(
        cause instanceof Error ? cause.message : "Service types could not be loaded.",
      );
    } finally {
      setPendingPlanningCenterOperation(null);
    }
  }, []);

  const savePlanningCenter = useCallback(
    async (
      input: PlanningCenterSettingsInput,
      serviceSource: ServiceSource,
      timezone: string,
    ) => {
      setPendingPlanningCenterOperation("save");
      setPlanningCenterError(null);
      setPlanningCenterMessage(null);
      try {
        const planningCenterResponse = await updatePlanningCenterSettings(input);
        const response = await updateSettings({
          ...planningCenterResponse.settings,
          timezone,
          integration_modes: {
            ...planningCenterResponse.settings.integration_modes,
            service_source: serviceSource,
          },
        });
        setSettings(response);
        setPlanningCenterStatus(await getPlanningCenterStatus());
        setPlanningCenterMessage(
          "Planning Center settings saved securely. Restart StagePilot to apply the service source.",
        );
      } catch (cause) {
        setPlanningCenterError(
          cause instanceof Error ? cause.message : "Planning Center settings could not be saved.",
        );
      } finally {
        setPendingPlanningCenterOperation(null);
      }
    },
    [],
  );

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

  const simulateMidi = useCallback(
    async (cue: MidiCueName) => {
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
    },
    [applyState, loadMidiMessages],
  );

  const saveProPresenter = useCallback(async (settings: ProPresenterSettingsInput) => {
    setPendingProPresenterOperation("save");
    setProPresenterError(null);
    setProPresenterMessage(null);
    try {
      const response = await updateProPresenterSettings(settings);
      setProPresenter(response.propresenter);
      setProPresenterMessage(response.message);
      if (!response.accepted) setProPresenterError(response.message);
    } catch (cause) {
      setProPresenterError(
        cause instanceof Error ? cause.message : "ProPresenter settings update failed.",
      );
    } finally {
      setPendingProPresenterOperation(null);
    }
  }, []);

  const runProPresenterTest = useCallback(async () => {
    setPendingProPresenterOperation("test");
    setProPresenterError(null);
    setProPresenterMessage(null);
    try {
      const response = await testProPresenter();
      setProPresenter(response.propresenter);
      setProPresenterMessage(response.message);
      if (!response.accepted) setProPresenterError(response.message);
    } catch (cause) {
      setProPresenterError(
        cause instanceof Error ? cause.message : "ProPresenter connection test failed.",
      );
    } finally {
      setPendingProPresenterOperation(null);
    }
  }, []);

  const refreshProPresenter = useCallback(async () => {
    setPendingProPresenterOperation("refresh");
    setProPresenterError(null);
    setProPresenterMessage(null);
    try {
      const response = await refreshProPresenterTimers();
      setProPresenter(response.propresenter);
      setProPresenterMessage(response.message);
      if (!response.accepted) setProPresenterError(response.message);
    } catch (cause) {
      setProPresenterError(
        cause instanceof Error ? cause.message : "ProPresenter timer refresh failed.",
      );
    } finally {
      setPendingProPresenterOperation(null);
    }
  }, []);

  return {
    state,
    health,
    live,
    error,
    actionMessage,
    pendingAction,
    pendingPlanId,
    settings,
    settingsError,
    settingsMessage,
    pendingSettingsOperation,
    planningCenterStatus,
    planningCenterServiceTypes,
    planningCenterError,
    planningCenterMessage,
    pendingPlanningCenterOperation,
    midi,
    midiMessages,
    midiError,
    midiMessage,
    pendingMidiOperation,
    pendingMidiCue,
    propresenter,
    propresenterError,
    propresenterMessage,
    pendingProPresenterOperation,
    dispatch,
    selectPlan,
    saveIntegrationModes,
    testPlanningCenterConnection,
    loadPlanningCenterServiceTypes,
    savePlanningCenter,
    refreshMidi,
    selectMidi,
    simulateMidi,
    saveProPresenter,
    runProPresenterTest,
    refreshProPresenter,
  };
}
