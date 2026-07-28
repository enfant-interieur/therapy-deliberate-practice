export const fr = {
  locale: {
    label: "Langue",
    english: "Anglais",
    french: "Français"
  },
  common: {
    advanced: "Avancé",
    close: "Fermer",
    copy: "Copier",
    copied: "Copié",
    error: "Erreur",
    fix: "Solution : {details}",
    idle: "En attente",
    loading: "Chargement",
    no: "Non",
    off: "Désactivé",
    ok: "OK",
    on: "Activé",
    ready: "Prêt",
    refresh: "Actualiser",
    requestTimedOut: "La requête a dépassé le délai autorisé.",
    running: "En cours",
    saved: "Enregistré",
    saving: "Enregistrement…",
    status: "État : {status}",
    step: "Étape {step}",
    stepOf: "Étape {step} sur {total}",
    stop: "Arrêter",
    unknownError: "Erreur inconnue.",
    yes: "Oui"
  },
  hero: {
    kicker: "Exécution locale",
    title: "Connectez-vous en quatre étapes guidées",
    subtitle:
      "Les modèles compatibles sont sélectionnés pour {platform}. La progression des téléchargements et les informations de connexion restent réunies au même endroit.",
    detectedMachine: "votre ordinateur",
    advanced: "Commandes avancées",
    launchTitle: "Démarrer le serveur local",
    launchDescription:
      "Démarrez la passerelle et laissez les contrôles de bon fonctionnement se terminer en arrière-plan.",
    doctorRecovery: "Corrigez le problème signalé par le diagnostic, puis réessayez.",
    prepareTitle: "Préparer vos modèles locaux",
    prepareDescription:
      "Choisissez un modèle de langage et un modèle vocal. Le premier téléchargement peut prendre plusieurs minutes ; sa progression reste visible ici.",
    copyTitle: "Copier vos informations de connexion",
    copyDescription:
      "Les paramètres Therapy ont besoin de ces deux valeurs. Votre clé d’association reste sur cet ordinateur.",
    settingsTitle: "Ouvrir les paramètres Therapy",
    settingsDescription:
      "Collez l’adresse locale et la clé d’association dans les champs indiqués, puis testez la connexion.",
    downloadFirst: "Téléchargez et chargez d’abord les modèles sélectionnés.",
    copyBothFirst: "Copiez d’abord les deux valeurs de connexion.",
    settingsOpened: "Paramètres ouverts",
    urlCopied: "Adresse copiée",
    pairingCopied: "Clé d’association copiée",
    nextOpenSettings: "Ensuite : ouvrir les paramètres"
  },
  launch: {
    startTitle: "Démarrer le serveur local",
    readyTitle: "Passerelle prête",
    failedTitle: "Échec du démarrage",
    launchingTitle: "Démarrage",
    idleMessage: "Démarrer le serveur local.",
    bootingMessage: "Démarrage du processus de la passerelle…",
    firstHealth: "En attente de la première réponse de bon fonctionnement…",
    readiness: "La passerelle indique « {status} » ; nouvelle vérification…",
    http: "La passerelle a renvoyé HTTP {status} ; nouvelle vérification…",
    noHealthyResponse: "Aucune réponse valide pour le moment ; nouvelle vérification…",
    readyMessage: "Passerelle prête.",
    failedMessage: "Le démarrage a échoué.",
    stoppedMessage: "Le démarrage a été arrêté.",
    idleSubtitle: "Démarre la passerelle locale et attend son contrôle de bon fonctionnement.",
    bootingSubtitle: "Démarrage du processus géré…",
    noResponse: "Aucune réponse pour le moment",
    healthSubtitle: "Contrôle nº {attempt} • {http}{readiness}",
    readinessSuffix: " • état : {status}",
    readySubtitle: "Vous pouvez passer à l’étape suivante.",
    stoppedSubtitle: "Vous pouvez relancer le serveur à tout moment.",
    errorSubtitle: "Consultez les journaux ou le diagnostic pour en savoir plus.",
    launchProgress: "Démarrage du processus en cours",
    healthPending: "Contrôle de bon fonctionnement en attente",
    healthChecks: "{count} {checks} terminé(s)",
    checkSingular: "contrôle",
    checkPlural: "contrôles"
  },
  model: {
    language: "Modèle de langage",
    speech: "Modèle vocal",
    selectLanguage: "Sélectionner un modèle de langage",
    selectSpeech: "Sélectionner un modèle vocal",
    downloadLoad: "Télécharger et charger les modèles sélectionnés",
    reload: "Recharger les modèles sélectionnés",
    preparing: "Préparation des modèles…",
    continues: "Le chargement continue dans la passerelle",
    refreshReadiness: "Actualiser l’état de préparation",
    platform: "Plateforme : {platform}",
    phase: {
      starting: "Démarrage…",
      running: "Téléchargement / chargement",
      completed: "Prêt",
      failed: "Intervention nécessaire",
      timedOut: "Pas encore prêt",
      idle: "Non chargé"
    },
    status: {
      pending: "En attente",
      loading: "Chargement",
      loaded: "Chargé",
      skipped: "Ignoré",
      error: "Erreur"
    },
    firstRun:
      "La première utilisation peut télécharger des fichiers de modèle. Gardez l’application de bureau ouverte ; les démarrages suivants réutiliseront le cache local.",
    checkCurrent: "Vérifier l’état actuel du chargement",
    prepareDescription:
      "Préparez les deux moteurs avant de connecter le site Therapy. Les téléchargements sont mis en cache localement et chaque moteur défaillant est signalé séparément."
  },
  connection: {
    kicker: "Connexion",
    title: "Adresses de la passerelle locale",
    baseUrl: "Adresse de base",
    llmUrl: "Adresse du modèle de langage",
    sttUrl: "Adresse du modèle vocal",
    pairingKey: "Clé d’association",
    pairingPrivate:
      "Gardez cette clé confidentielle. Elle autorise les requêtes du navigateur vers les modèles de cet ordinateur.",
    reveal: "Afficher",
    hide: "Masquer",
    creatingKey: "Création de la clé d’association…",
    rotate: "Renouveler la clé d’association",
    rotating: "Renouvellement…",
    rotateConfirm:
      "Renouveler la clé d’association ? Le site Therapy sera déconnecté jusqu’à ce que vous colliez la nouvelle clé. La passerelle redémarrera si elle est active.",
    rotateSuccess: "Nouvelle clé créée. Mettez à jour les paramètres Therapy.",
    rotateFailure: "Impossible de renouveler la clé.",
    health: "Ouvrir le contrôle de bon fonctionnement",
    copyLlm: "Copier l’exemple d’adresse du modèle de langage",
    copyStt: "Copier l’exemple d’adresse du modèle vocal",
    wherePaste: "Où faut-il coller ces valeurs ?",
    wherePasteAnswer:
      "Ouvrez les paramètres Therapy et collez l’adresse de base et la clé d’association.",
    openSettings: "Ouvrir les paramètres Therapy",
    help: "Aide",
    storageTitle: "Fichiers locaux",
    configPath: "Fichier de configuration",
    dataPath: "Dossier de données",
    cachePath: "Cache des modèles",
    logPolicy: "Politique de journalisation",
    metadataOnly:
      "Métadonnées uniquement. Les consignes, transcriptions, enregistrements audio et sorties des modèles ne sont pas écrits dans les journaux ordinaires.",
    clipboardFailure:
      "Le presse-papiers est indisponible. Sélectionnez la valeur et copiez-la manuellement."
  },
  tests: {
    run: "Tester le langage et la transcription",
    running: "Tests en cours…",
    results: "Résultats des tests rapides",
    preview: "Aperçu : {preview}",
    empty: "Les résultats apparaîtront après l’exécution du test.",
    silentAudio: "Le moteur a répondu correctement au signal audio silencieux."
  },
  port: {
    label: "Port de la passerelle",
    help: "Choisissez un port entre 1024 et 65535. La passerelle et les adresses ci-dessus seront mises à jour.",
    invalid: "Saisissez un port valide compris entre 1024 et 65535.",
    save: "Enregistrer le port",
    useDefault: "Utiliser 8484",
    saveFailed: "Échec de l’enregistrement du port. Réessayez.",
    saved: "Port enregistré.",
    restartNotice:
      "L’enregistrement de cette modification redémarrera automatiquement la passerelle sur le nouveau port."
  },
  wizard: {
    kicker: "Assistant de configuration",
    title: "Préparez l’application en quelques minutes",
    startGateway: "Démarrer la passerelle",
    startDescription: "Démarrez la passerelle locale afin de détecter les modèles.",
    discover: "Découvrir les modèles disponibles",
    discoverDescription:
      "Lire le catalogue des modèles compatibles depuis la passerelle active.",
    choose: "Choisir les modèles de langage et de transcription par défaut",
    chooseDescription:
      "Choisissez les modèles que la suite utilisera par défaut pendant les séances.",
    download: "Télécharger et charger les modèles",
    downloadDescription:
      "Préparer les modèles locaux sélectionnés et afficher leur progression réelle.",
    save: "Enregistrer les préférences",
    saveDescription:
      "Conserver les modèles sélectionnés par défaut et la préférence d’acheminement.",
    configure: "Configurer les paramètres Therapy",
    configureDescription:
      "Ouvrir la page des paramètres afin de connecter les préférences enregistrées.",
    blocked: "Bloqué : {details}",
    discoverCompatible: "Découvrir les modèles compatibles",
    catalogCount: "{count} modèles disponibles",
    noCatalog: "Catalogue indisponible",
    platformDescription:
      "Lire le catalogue et masquer les modèles incompatibles avec {platform}.",
    refreshModels: "Actualiser les modèles",
    defaults: "Choisir les modèles par défaut",
    defaultsSelected: "Modèles par défaut sélectionnés",
    waitingSelections: "En attente de vos choix",
    defaultLlm: "Modèle de langage par défaut",
    defaultStt: "Modèle de transcription par défaut",
    selectLlm: "Sélectionner le modèle de langage",
    selectStt: "Sélectionner le modèle de transcription",
    selectDescription:
      "Sélectionnez les modèles de langage et de transcription que vous préférez utiliser pendant les séances.",
    saveDefaultsDescription:
      "Enregistrez vos modèles par défaut afin que la passerelle les utilise à chaque démarrage.",
    preferLocal: "Privilégier les modèles locaux aux fournisseurs mandataires",
    saveFailed: "Échec de l’enregistrement. Réessayez.",
    preferencesSaved: "Préférences enregistrées",
    notSaved: "Non enregistré",
    preferencesReady:
      "Vos préférences sont prêtes. Continuez dans les paramètres Therapy.",
    nextSettings: "Ensuite : configurer les paramètres Therapy",
    finishSetup:
      "Terminez la configuration en associant ces préférences dans l’application web Therapy.",
    copySettingsLink: "Copier le lien des paramètres",
    gatewayStarting: "Démarrage de la passerelle",
    gatewayStopped: "Passerelle arrêtée",
    launchBeforeModels:
      "Démarrez la passerelle locale avant de charger les modèles. Vous pouvez l’arrêter à tout moment.",
    start: "Démarrer la passerelle",
    stop: "Arrêter la passerelle",
    doctor: "Lancer le diagnostic",
    startFailed: "Échec du démarrage de la passerelle.",
    thisPlatform: "cette plateforme"
  },
  logs: {
    kicker: "Journaux",
    title: "Sortie de la passerelle",
    privacy:
      "Les journaux affichent uniquement des métadonnées opérationnelles. Le contenu thérapeutique sensible en est exclu.",
    refresh: "Actualiser les journaux",
    copy: "Copier les journaux",
    clear: "Effacer les journaux",
    autoScroll: "Défilement automatique : {state}",
    none: "Aucun journal pour le moment.",
    importFailure:
      "La passerelle n’a pas pu importer local_runtime. Le paquet Python est absent de l’emplacement attendu.",
    copyFix: "Copier les étapes de résolution",
    fixSteps:
      "Étapes de résolution :\n1) Définissez LOCAL_RUNTIME_ROOT sur la racine du paquet Python local_runtime.\n2) Ou incluez resources/local_runtime dans la compilation Tauri.\n3) Redémarrez la passerelle."
  },
  errors: {
    gatewayStoppedBeforeReady:
      "Le processus de la passerelle s’est arrêté avant que son contrôle de bon fonctionnement ne soit prêt.",
    gatewayHealthTimeout:
      "Le délai d’attente du contrôle de bon fonctionnement de la passerelle a expiré.",
    modelWaitTimeout:
      "L’application de bureau a cessé d’attendre après 15 minutes, mais le chargement continue dans la passerelle. Vérifiez l’état de cette tâche au lieu d’en lancer une autre.",
    modelLoadFailed: "Un ou plusieurs modèles sélectionnés n’ont pas pu être chargés.",
    startBeforeModels: "Démarrez la passerelle avant de charger les modèles.",
    chooseModels: "Choisissez d’abord un modèle de langage et un modèle vocal.",
    statusInterrupted:
      "La connexion de suivi a été interrompue, mais la tâche peut continuer dans la passerelle : {details}",
    statusInterruptedAgain:
      "La connexion de suivi a de nouveau été interrompue : {details}",
    previousGatewayRestarted:
      " La configuration précédente de la passerelle a été redémarrée.",
    previousGatewayRestartFailed:
      " La passerelle précédente n’a pas pu redémarrer non plus : {details}",
    portSavedRestartFailed:
      "Le port {port} a été enregistré, mais la passerelle n’a pas pu redémarrer : {details}",
    portNotApplied:
      "Le port de la passerelle n’a pas été appliqué : {details}{recovery}",
    gatewayNotRunning:
      "La passerelle n’est pas active. Démarrez-la avant d’exécuter les tests.",
    modelsNotLoaded:
      "Les modèles sélectionnés ne sont pas encore chargés. Téléchargez-les et chargez-les avant d’exécuter les tests.",
    pairingUnavailable:
      "La clé d’association est indisponible. Rouvrez l’application de bureau, puis réessayez.",
    llmMissingText: "La réponse du modèle de langage ne contient pas de texte.",
    sttMissingText: "La réponse de transcription ne contient pas de texte.",
    loadFailed: "échec du chargement",
    unknownModelError: "erreur de modèle inconnue",
    launchStartFailed: "Impossible de démarrer la passerelle : {details}",
    launchStopFailed: "Impossible d’arrêter la passerelle : {details}",
    launchHealthTimeout:
      "Le délai d’attente du contrôle de bon fonctionnement a expiré (10 minutes)."
  },
  events: {
    refreshCatalog: "Actualisation du catalogue des modèles depuis la passerelle.",
    modelWaitPaused:
      "Le suivi de l’application s’est arrêté après 15 minutes ; le chargement continue dans la passerelle.",
    modelsLoaded: "Les modèles sélectionnés sont téléchargés et chargés.",
    modelLoadFailed: "Échec du chargement des modèles : {details}",
    modelLoadStarting: "Démarrage du chargement de {count} modèle(s) sélectionné(s).",
    modelLoadUnavailable: "Impossible de charger les modèles sélectionnés : {details}",
    modelLoadCheck: "Vérification de la tâche de chargement {id}.",
    modelLoadResumeFailed: "Impossible de reprendre le suivi du chargement : {details}",
    savingPreferences: "Enregistrement des préférences dans la configuration de la passerelle.",
    savePreferencesFailed: "Échec de l’enregistrement des préférences.",
    portStopping: "Arrêt de la passerelle avant le passage au port {port}.",
    portSaving: "Enregistrement du port {port} de la passerelle.",
    portStarting: "Démarrage de la passerelle sur le port {port}.",
    portRecovery: "Échec de l’enregistrement du port ; redémarrage de la configuration précédente.",
    doctorRunning: "Exécution des contrôles diagnostiques préalables.",
    doctorFailed: "Échec du diagnostic : {details}",
    gatewayStarting: "Démarrage de la passerelle locale.",
    gatewayStartFailed: "Échec du démarrage de la passerelle : {details}",
    gatewayStopped: "Passerelle locale arrêtée.",
    pairingRotated: "Clé d’association locale renouvelée.",
    pairingRotationFailed: "Échec du renouvellement de la clé d’association : {details}",
    clipboardCopied: "Texte copié dans le presse-papiers.",
    llmTestRunning: "Exécution du test du modèle de langage…",
    llmTestOk: "Test du modèle de langage réussi ({duration} ms).",
    llmTestFailed: "Échec du test du modèle de langage : {details}",
    sttTestRunning: "Exécution du test de transcription…",
    sttTestOk: "Test de transcription réussi ({duration} ms).",
    sttTestFailed: "Échec du test de transcription : {details}",
    launchFailed: "Échec du démarrage de la passerelle : {details}",
    healthPassed: "Les contrôles de bon fonctionnement ont réussi.",
    runtimeRefreshFailed: "Impossible d’actualiser l’état d’exécution : {details}",
    readinessRefreshFailed: "Impossible d’actualiser l’état de préparation : {details}",
    defaultsSelected: "Modèles compatibles sélectionnés pour {platform}.",
    launchBlocked: "Démarrage bloqué jusqu’à la résolution des problèmes diagnostiqués.",
    launchStarting: "Démarrage de la passerelle locale depuis la commande guidée.",
    launchStopping: "Arrêt du démarrage de la passerelle locale.",
    advancedOpened: "Commandes de connexion avancées ouvertes.",
    settingsOpened: "Paramètres Therapy ouverts.",
    helpOpened: "Centre d’aide ouvert."
  },
  doctor: {
    kicker: "Diagnostic",
    title: "Contrôles préalables",
    none: "Lancez le diagnostic pour vérifier la configuration, les ports, les dépendances et le stockage.",
    running: "Diagnostic en cours…",
    retry: "Relancer le diagnostic",
    runFailed: "Le diagnostic n’a pas pu aboutir : {details}",
    noTechnicalDetail: "Aucun détail technique n’a été fourni.",
    gatewayConfiguration: {
      title: "Configuration de la passerelle",
      error: "La configuration de la passerelle n’a pas pu être résolue : {details}",
      fix: "Définissez LOCAL_RUNTIME_ROOT ou incluez les ressources de l’exécution locale."
    },
    pythonExecutable: {
      title: "Exécutable Python",
      ok: "Python est disponible.",
      okVersion: "Version utilisée : {version}",
      error: "Python n’a pas pu démarrer : {details}",
      fix: "Installez Python 3.10 ou une version ultérieure, ou définissez LOCAL_RUNTIME_PYTHON sur un interpréteur valide."
    },
    localRuntimeImport: {
      title: "Import de local_runtime",
      ok: "local_runtime a été trouvé à l’emplacement {path}",
      error: "local_runtime n’a pas pu être importé : {details}",
      fix: "Définissez LOCAL_RUNTIME_ROOT sur la racine du paquet Python ou incluez resources/local_runtime."
    },
    gatewaySidecarBinary: {
      title: "Binaire auxiliaire de la passerelle",
      ok: "Le binaire auxiliaire a été trouvé à l’emplacement {path}",
      error: "Le binaire auxiliaire est introuvable.",
      fix: "Utilisez la configuration auxiliaire Tauri prévue ou construisez le binaire avant de lancer l’application."
    },
    gatewaySidecarPermissions: {
      title: "Autorisations du binaire auxiliaire",
      error: "Le binaire auxiliaire situé à {path} n’est pas exécutable.",
      fix: "Accordez l’autorisation d’exécution au fichier du binaire auxiliaire."
    },
    portAvailability: {
      title: "Disponibilité du port",
      free: "Le port {port} est libre.",
      running: "Le port {port} est utilisé par la passerelle active.",
      starting: "Le port {port} est utilisé pendant le démarrage de la passerelle.",
      inUse: "Le port {port} est déjà utilisé par un autre processus.",
      wait: "Attendez que le contrôle de santé de la passerelle soit prêt.",
      fix: "Choisissez un autre port dans l’application ou arrêtez le processus qui utilise celui-ci."
    },
    gatewayHealth: {
      title: "Santé de la passerelle",
      ok: "Le contrôle de santé a réussi : {details}",
      error: "La passerelle a répondu, mais son contrôle de santé a échoué : {details}",
      starting: "La passerelle démarre ; son contrôle de santé n’est pas encore prêt.",
      stopped: "La passerelle n’est pas encore active.",
      inspectLogs: "Ouvrez les journaux de la passerelle pour examiner les erreurs de démarrage.",
      wait: "Attendez la fin du démarrage ou examinez les journaux si l’attente devient anormalement longue.",
      start: "Démarrez la passerelle pour vérifier son état de santé."
    },
    unknown: {
      title: "Contrôle diagnostique ({code})"
    }
  },
  gatewayStatus: {
    stopped: "Arrêtée",
    starting: "Démarrage",
    running: "Active",
    foreign: "Un autre service utilise le port",
    unknown: "Inconnu"
  },
  accessibility: {
    advancedDialog: "Commandes avancées de l’exécution locale",
    languageSelect: "Langue de l’interface"
  }
} as const;
