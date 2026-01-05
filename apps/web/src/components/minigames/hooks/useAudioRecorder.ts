import { useMicRecorder } from "../../../hooks/useMicRecorder";

export const useAudioRecorder = () => {
  const recorder = useMicRecorder({ loggerScope: "minigames" });
  return {
    ...recorder,
    startRecording: recorder.startFromUserGesture,
    stopRecording: recorder.stop
  };
};
