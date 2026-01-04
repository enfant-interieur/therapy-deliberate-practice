export type PatientAudioLogger = (event: string, payload?: Record<string, unknown>) => void;

export const createPatientAudioLogger = (scope: string): PatientAudioLogger => {
  return (event, payload) => {
    if (!import.meta.env.DEV) return;
    const details = payload ? { ...payload } : undefined;
    console.info(`[patient-audio:${scope}] ${event}`, details ?? "");
  };
};
