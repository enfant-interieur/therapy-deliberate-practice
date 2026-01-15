const WAV_HEADER_SIZE = 44;

export const TARGET_SAMPLE_RATE = 16000;
export const WAV_MIME_TYPE = "audio/wav";

const floatTo16BitPCM = (view: DataView, offset: number, input: Float32Array) => {
  let writeOffset = offset;
  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(writeOffset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    writeOffset += 2;
  }
};

export const mixToMonoBuffer = (buffer: AudioBuffer) => {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0).slice();
  }
  const length = buffer.length;
  const result = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      result[i] += channelData[i];
    }
  }
  for (let i = 0; i < length; i += 1) {
    result[i] /= buffer.numberOfChannels;
  }
  return result;
};

export const resampleLinear = (input: Float32Array, inRate: number, outRate: number) => {
  if (inRate === outRate) {
    return input;
  }
  const ratio = inRate / outRate;
  const targetLength = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(targetLength);
  for (let i = 0; i < targetLength; i += 1) {
    const mapped = i * ratio;
    const index = Math.floor(mapped);
    const nextIndex = Math.min(index + 1, input.length - 1);
    const mix = mapped - index;
    result[i] = input[index] + (input[nextIndex] - input[index]) * mix;
  }
  return result;
};

export const encodeWav = (samples: Float32Array, sampleRate: number) => {
  const buffer = new ArrayBuffer(WAV_HEADER_SIZE + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  floatTo16BitPCM(view, WAV_HEADER_SIZE, samples);
  return buffer;
};

export const shouldForceWav = (mimeType?: string | null) => {
  if (!mimeType) return true;
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("wav")) return false;
  return ["webm", "mp4", "aac", "mpeg", "ogg"].some((token) => normalized.includes(token));
};

export const resolveAudioContextCtor = () => {
  if (typeof window === "undefined") return null;
  const candidate = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return candidate ?? null;
};

export const convertBlobToWav = async (blob: Blob) => {
  const AudioContextCtor = resolveAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error("AudioContext is unavailable");
  }
  const audioData = await blob.arrayBuffer();
  const context = new AudioContextCtor();
  try {
    const decoded = await context.decodeAudioData(audioData.slice(0));
    const mono = mixToMonoBuffer(decoded);
    const resampled = resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
    const wavBuffer = encodeWav(resampled, TARGET_SAMPLE_RATE);
    return new Blob([wavBuffer], { type: WAV_MIME_TYPE });
  } finally {
    try {
      await context.close();
    } catch {
      // ignored
    }
  }
};

export const normalizeUploadBlob = async (
  blob: Blob,
  mimeType?: string | null
): Promise<{ blob: Blob; mimeType: string }> => {
  if (!shouldForceWav(mimeType ?? blob.type)) {
    return { blob, mimeType: mimeType ?? blob.type ?? WAV_MIME_TYPE };
  }
  try {
    const wavBlob = await convertBlobToWav(blob);
    return { blob: wavBlob, mimeType: WAV_MIME_TYPE };
  } catch (error) {
    console.warn("Failed to convert audio blob to WAV; sending original payload.", error);
    return { blob, mimeType: mimeType ?? blob.type ?? WAV_MIME_TYPE };
  }
};
