export const en = {
  locale: {
    label: "Language",
    english: "English",
    french: "French"
  },
  common: {
    advanced: "Advanced",
    close: "Close",
    copy: "Copy",
    copied: "Copied",
    error: "Error",
    fix: "Fix: {details}",
    idle: "Idle",
    loading: "Loading",
    no: "No",
    off: "Off",
    ok: "OK",
    on: "On",
    ready: "Ready",
    refresh: "Refresh",
    requestTimedOut: "Request timed out.",
    running: "Running",
    saved: "Saved",
    saving: "Saving…",
    status: "Status: {status}",
    step: "Step {step}",
    stepOf: "Step {step} of {total}",
    stop: "Stop",
    unknownError: "Unknown error.",
    yes: "Yes"
  },
  hero: {
    kicker: "Local Runtime",
    title: "Connect in four guided steps",
    subtitle:
      "Compatible models are selected for {platform}, with download progress and connection details in one place.",
    detectedMachine: "your machine",
    advanced: "Advanced controls",
    launchTitle: "Launch local server",
    launchDescription:
      "Start the gateway and let the health checks finish in the background.",
    doctorRecovery: "Resolve the doctor issue above and retry.",
    prepareTitle: "Prepare your local models",
    prepareDescription:
      "Choose one language model and one speech model. The first download can take a few minutes; progress remains visible here.",
    copyTitle: "Copy your connection details",
    copyDescription:
      "Therapy Settings needs both values. Your pairing key stays on this computer.",
    settingsTitle: "Open Therapy Settings",
    settingsDescription:
      "Paste the local URL and pairing key into their labeled fields, then test the connection.",
    downloadFirst: "Download and load the selected models first.",
    copyBothFirst: "Copy both connection values first.",
    settingsOpened: "Settings opened",
    urlCopied: "URL copied",
    pairingCopied: "Pairing key copied",
    nextOpenSettings: "Next: Open Settings"
  },
  launch: {
    startTitle: "Launch local server",
    readyTitle: "Gateway ready",
    failedTitle: "Launch failed",
    launchingTitle: "Launching",
    idleMessage: "Launch local server.",
    bootingMessage: "Starting the gateway process…",
    firstHealth: "Waiting for the first health response…",
    readiness: "Gateway reported “{status}”; checking again…",
    http: "Gateway returned HTTP {status}; checking again…",
    noHealthyResponse: "No healthy response yet; checking again…",
    readyMessage: "Gateway ready.",
    failedMessage: "Startup failed.",
    stoppedMessage: "Startup stopped.",
    idleSubtitle: "Starts the local gateway and waits for its health check.",
    bootingSubtitle: "Starting the managed process…",
    noResponse: "No response yet",
    healthSubtitle: "Health check #{attempt} • {http}{readiness}",
    readinessSuffix: " • status: {status}",
    readySubtitle: "You can continue to the next step.",
    stoppedSubtitle: "You can launch again at any time.",
    errorSubtitle: "Check Logs or Doctor for details.",
    launchProgress: "Process launch in progress",
    healthPending: "Health check pending",
    healthChecks: "{count} health {checks} completed",
    checkSingular: "check",
    checkPlural: "checks"
  },
  model: {
    language: "Language model",
    speech: "Speech model",
    selectLanguage: "Select language model",
    selectSpeech: "Select speech model",
    downloadLoad: "Download and load selected models",
    reload: "Reload selected models",
    preparing: "Preparing models…",
    continues: "Load continues in the gateway",
    refreshReadiness: "Refresh readiness",
    platform: "Platform: {platform}",
    phase: {
      starting: "Starting…",
      running: "Downloading / loading",
      completed: "Ready",
      failed: "Needs attention",
      timedOut: "Still not ready",
      idle: "Not loaded"
    },
    status: {
      pending: "Pending",
      loading: "Loading",
      loaded: "Loaded",
      skipped: "Skipped",
      error: "Error"
    },
    firstRun:
      "The first run may download model files. Keep the desktop app open; later starts reuse the local cache.",
    checkCurrent: "Check current load status",
    prepareDescription:
      "Prepare both engines before connecting the Therapy website. Downloads are cached locally, and a failed engine is reported separately."
  },
  connection: {
    kicker: "Connection",
    title: "Local gateway URLs",
    baseUrl: "Base URL",
    llmUrl: "LLM URL",
    sttUrl: "STT URL",
    pairingKey: "Pairing key",
    pairingPrivate:
      "Keep this key private. It authorizes browser requests to models on this computer.",
    reveal: "Reveal",
    hide: "Hide",
    creatingKey: "Creating pairing key…",
    rotate: "Rotate pairing key",
    rotating: "Rotating…",
    rotateConfirm:
      "Rotate the pairing key? The Therapy website will disconnect until you paste the new key. The gateway will restart if it is running.",
    rotateSuccess: "New key created. Update Therapy Settings.",
    rotateFailure: "Could not rotate the key.",
    health: "Open health check",
    copyLlm: "Copy example LLM endpoint",
    copyStt: "Copy example STT endpoint",
    wherePaste: "Where do I paste these?",
    wherePasteAnswer:
      "Open Therapy Settings and paste the Base URL and pairing key.",
    openSettings: "Open Therapy Settings",
    help: "Help",
    storageTitle: "Local files",
    configPath: "Configuration file",
    dataPath: "Data directory",
    cachePath: "Model cache",
    logPolicy: "Logging policy",
    metadataOnly:
      "Metadata only. Prompts, transcripts, audio, and model output are not written to ordinary logs.",
    clipboardFailure:
      "The clipboard is unavailable. Select the value and copy it manually."
  },
  tests: {
    run: "Run LLM + speech test",
    running: "Running tests…",
    results: "Quick test results",
    preview: "Preview: {preview}",
    empty: "Results appear after running the test.",
    silentAudio: "Engine responded correctly to silent audio."
  },
  port: {
    label: "Gateway port",
    help: "Choose a port between 1024 and 65535. This updates the gateway and the URLs above.",
    invalid: "Enter a valid port between 1024 and 65535.",
    save: "Save port",
    useDefault: "Use 8484",
    saveFailed: "Port save failed. Try again.",
    saved: "Port saved.",
    restartNotice:
      "Saving this change will restart the gateway automatically on the new port."
  },
  wizard: {
    kicker: "Setup Wizard",
    title: "Get ready in minutes",
    startGateway: "Start the gateway",
    startDescription: "Launch the local gateway so models can be discovered.",
    discover: "Discover available models",
    discoverDescription:
      "Read the compatible model catalog from the running gateway.",
    choose: "Choose default LLM + STT",
    chooseDescription: "Pick the defaults the suite should use for sessions.",
    download: "Download and load models",
    downloadDescription:
      "Prepare the selected local models and show their actual progress.",
    save: "Save preferences",
    saveDescription: "Persist your default selections and routing preference.",
    configure: "Configure Therapy Settings",
    configureDescription:
      "Open the settings page to connect your saved preferences.",
    blocked: "Blocked: {details}",
    discoverCompatible: "Discover compatible models",
    catalogCount: "{count} models available",
    noCatalog: "No catalog yet",
    platformDescription: "Read the catalog and hide models that cannot run on {platform}.",
    refreshModels: "Refresh models",
    defaults: "Choose defaults",
    defaultsSelected: "Defaults selected",
    waitingSelections: "Waiting on selections",
    defaultLlm: "Default LLM",
    defaultStt: "Default STT",
    selectLlm: "Select LLM",
    selectStt: "Select STT",
    selectDescription:
      "Select your preferred LLM and STT models to use in sessions.",
    saveDefaultsDescription:
      "Save your defaults so the gateway uses them whenever it starts.",
    preferLocal: "Prefer local models over proxy providers",
    saveFailed: "Save failed. Try again.",
    preferencesSaved: "Preferences saved",
    notSaved: "Not saved",
    preferencesReady:
      "Your preferences are ready. Continue to Therapy Settings.",
    nextSettings: "Next: Configure in Therapy Settings",
    finishSetup:
      "Finish setup by linking these preferences in the Therapy web app.",
    copySettingsLink: "Copy Settings Link",
    gatewayStarting: "Gateway starting",
    gatewayStopped: "Gateway stopped",
    launchBeforeModels:
      "Launch the local gateway before loading models. You can stop it at any time.",
    start: "Start gateway",
    stop: "Stop gateway",
    doctor: "Run doctor",
    startFailed: "Gateway failed to start.",
    thisPlatform: "this platform"
  },
  logs: {
    kicker: "Logs",
    title: "Gateway output",
    privacy:
      "Logs show operational metadata only. Sensitive therapy content is excluded.",
    refresh: "Refresh logs",
    copy: "Copy logs",
    clear: "Clear logs",
    autoScroll: "Auto-scroll: {state}",
    none: "No logs yet.",
    importFailure:
      "The gateway could not import local_runtime. The Python package is missing from the expected path.",
    copyFix: "Copy fix steps",
    fixSteps:
      "Fix steps:\n1) Set LOCAL_RUNTIME_ROOT to the local_runtime Python package root.\n2) Or bundle resources/local_runtime in the Tauri build.\n3) Restart the gateway."
  },
  errors: {
    gatewayStoppedBeforeReady:
      "The gateway process stopped before its health check became ready.",
    gatewayHealthTimeout: "Timed out waiting for the gateway health check.",
    modelWaitTimeout:
      "The desktop app stopped waiting after 15 minutes, but the gateway load job is still running. Check its current status instead of starting a duplicate job.",
    modelLoadFailed: "One or more selected models could not be loaded.",
    startBeforeModels: "Start the gateway before loading models.",
    chooseModels: "Choose a language model and a speech model first.",
    statusInterrupted:
      "The status connection was interrupted, but the gateway job may still be running: {details}",
    statusInterruptedAgain:
      "The status connection was interrupted again: {details}",
    previousGatewayRestarted:
      " The previous gateway configuration was restarted.",
    previousGatewayRestartFailed:
      " The previous gateway also could not be restarted: {details}",
    portSavedRestartFailed:
      "Port {port} was saved, but the gateway could not restart: {details}",
    portNotApplied:
      "The gateway port was not applied: {details}{recovery}",
    gatewayNotRunning:
      "The gateway is not running. Start it before running tests.",
    modelsNotLoaded:
      "The selected models are not loaded yet. Download and load them before running tests.",
    pairingUnavailable:
      "The pairing key is unavailable. Reopen the desktop app and try again.",
    llmMissingText: "The language-model response did not contain text.",
    sttMissingText: "The transcription response did not contain text.",
    loadFailed: "load failed",
    unknownModelError: "unknown model error",
    launchStartFailed: "Failed to start the gateway: {details}",
    launchStopFailed: "Could not stop the gateway: {details}",
    launchHealthTimeout:
      "Timed out waiting for the gateway health check (10 minutes)."
  },
  events: {
    refreshCatalog: "Refreshing the model catalog from the gateway.",
    modelWaitPaused:
      "Desktop polling paused after 15 minutes; the gateway load job continues.",
    modelsLoaded: "Selected models are downloaded and loaded.",
    modelLoadFailed: "Model load failed: {details}",
    modelLoadStarting: "Starting model load for {count} selected model(s).",
    modelLoadUnavailable: "Unable to load selected models: {details}",
    modelLoadCheck: "Checking model-load job {id}.",
    modelLoadResumeFailed: "Unable to resume model-load status: {details}",
    savingPreferences: "Saving preferences to the gateway configuration.",
    savePreferencesFailed: "Failed to save preferences.",
    portStopping: "Stopping the gateway before changing its port to {port}.",
    portSaving: "Saving gateway port {port}.",
    portStarting: "Starting the gateway on port {port}.",
    portRecovery: "Port save failed; restarting the previous gateway configuration.",
    doctorRunning: "Running preflight diagnostic checks.",
    doctorFailed: "Doctor checks failed: {details}",
    gatewayStarting: "Starting the local gateway.",
    gatewayStartFailed: "Gateway failed to start: {details}",
    gatewayStopped: "Stopped the local gateway.",
    pairingRotated: "Rotated the local pairing key.",
    pairingRotationFailed: "Pairing-key rotation failed: {details}",
    clipboardCopied: "Copied text to the clipboard.",
    llmTestRunning: "Running the language-model test…",
    llmTestOk: "Language-model test passed ({duration} ms).",
    llmTestFailed: "Language-model test failed: {details}",
    sttTestRunning: "Running the transcription test…",
    sttTestOk: "Transcription test passed ({duration} ms).",
    sttTestFailed: "Transcription test failed: {details}",
    launchFailed: "Gateway launch failed: {details}",
    healthPassed: "Gateway health checks passed.",
    runtimeRefreshFailed: "Unable to refresh runtime state: {details}",
    readinessRefreshFailed: "Unable to refresh gateway readiness: {details}",
    defaultsSelected: "Selected compatible defaults for {platform}.",
    launchBlocked: "Launch blocked until diagnostic issues are resolved.",
    launchStarting: "Launching the local gateway from the guided control.",
    launchStopping: "Stopping the local gateway launch.",
    advancedOpened: "Opened advanced connection controls.",
    settingsOpened: "Opened Therapy Settings.",
    helpOpened: "Opened the Help centre."
  },
  doctor: {
    kicker: "Doctor",
    title: "Preflight checks",
    none: "Run Doctor to inspect configuration, ports, dependencies, and storage.",
    running: "Running doctor…",
    retry: "Retry doctor",
    runFailed: "Doctor could not complete: {details}",
    noTechnicalDetail: "No technical detail was provided.",
    gatewayConfiguration: {
      title: "Gateway configuration",
      error: "The gateway configuration could not be resolved: {details}",
      fix: "Set LOCAL_RUNTIME_ROOT or bundle the local runtime resources."
    },
    pythonExecutable: {
      title: "Python executable",
      ok: "Python is available.",
      okVersion: "Using {version}",
      error: "Python could not be started: {details}",
      fix: "Install Python 3.10 or later, or set LOCAL_RUNTIME_PYTHON to a valid interpreter."
    },
    localRuntimeImport: {
      title: "local_runtime import",
      ok: "Resolved local_runtime at {path}",
      error: "local_runtime could not be imported: {details}",
      fix: "Set LOCAL_RUNTIME_ROOT to the Python package root or bundle resources/local_runtime."
    },
    gatewaySidecarBinary: {
      title: "Gateway sidecar binary",
      ok: "Found the sidecar at {path}",
      error: "The sidecar binary could not be found.",
      fix: "Use the configured Tauri sidecar setup or build the sidecar before launching the desktop app."
    },
    gatewaySidecarPermissions: {
      title: "Gateway sidecar permissions",
      error: "The sidecar at {path} is not executable.",
      fix: "Grant execute permission to the sidecar file."
    },
    portAvailability: {
      title: "Port availability",
      free: "Port {port} is free.",
      running: "Port {port} is bound by the running gateway.",
      starting: "Port {port} is bound while the gateway starts.",
      inUse: "Port {port} is already in use by another process.",
      wait: "Wait for the gateway health check to become ready.",
      fix: "Choose another port in the desktop app or stop the process using this port."
    },
    gatewayHealth: {
      title: "Gateway health",
      ok: "Health check passed: {details}",
      error: "The gateway responded, but its health check failed: {details}",
      starting: "The gateway process is starting; health is not ready yet.",
      stopped: "The gateway is not running yet.",
      inspectLogs: "Open the gateway logs to inspect startup errors.",
      wait: "Wait for startup to finish, or inspect logs if it takes unusually long.",
      start: "Start the gateway to verify health."
    },
    unknown: {
      title: "Diagnostic check ({code})"
    }
  },
  gatewayStatus: {
    stopped: "Stopped",
    starting: "Starting",
    running: "Running",
    foreign: "Another service is using the port",
    unknown: "Unknown"
  },
  accessibility: {
    advancedDialog: "Advanced Local Runtime controls",
    languageSelect: "Interface language"
  }
} as const;
