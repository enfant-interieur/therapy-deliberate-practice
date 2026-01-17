import { useEffect, useRef } from "react";

type AudioReactiveBackgroundProps = {
  audioElement?: HTMLAudioElement | null;
  isPlaying: boolean;
};

type Particle = {
  x: number;
  y: number;
  size: number;
  speed: number;
  phase: number;
};

export const AudioReactiveBackground = ({ audioElement, isPlaying }: AudioReactiveBackgroundProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * ratio;
      canvas.height = window.innerHeight * ratio;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      const count = Math.min(900, Math.max(400, Math.floor(window.innerWidth / 2)));
      particlesRef.current = Array.from({ length: count }).map(() => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        size: 1 + Math.random() * 2,
        speed: 0.1 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2
      }));
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!audioElement) return;

    let disposed = false;

    const ensureAudioContext = () => {
      if (disposed || !audioElement) return null;
      if (audioContextRef.current) return audioContextRef.current;
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaElementSource(audioElement);
      source.connect(analyser);
      analyser.connect(audioContext.destination);
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(analyser.frequencyBinCount);
      audioContextRef.current = audioContext;
      sourceRef.current = source;
      return audioContext;
    };

    const resumeAudioContext = () => {
      const context = ensureAudioContext();
      if (!context) return;
      if (context.state === "suspended") {
        context.resume().catch(() => {
          /* ignored */
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resumeAudioContext();
      }
    };

    resumeAudioContext();
    const gestureEvents = ["pointerdown", "touchstart", "keydown"] as const;
    gestureEvents.forEach((event) => window.addEventListener(event, resumeAudioContext));
    audioElement.addEventListener("play", resumeAudioContext);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      gestureEvents.forEach((event) => window.removeEventListener(event, resumeAudioContext));
      audioElement.removeEventListener("play", resumeAudioContext);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (sourceRef.current) {
        try {
          sourceRef.current.disconnect();
        } catch {
          /* ignored */
        }
        sourceRef.current = null;
      }
      if (analyserRef.current) {
        try {
          analyserRef.current.disconnect();
        } catch {
          /* ignored */
        }
        analyserRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {
          /* ignored */
        });
        audioContextRef.current = null;
      }
      dataRef.current = null;
    };
  }, [audioElement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);

      const analyser = analyserRef.current;
      const dataArray = dataRef.current;
      let intensity = 0.2;
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
        intensity = Math.min(1, avg / 200);
      }

      ctx.fillStyle = "rgba(10, 20, 36, 0.6)";
      ctx.fillRect(0, 0, width, height);

      const waveAmplitude = 20 + intensity * 80;
      ctx.beginPath();
      ctx.moveTo(0, height * 0.5);
      for (let x = 0; x <= width; x += 20) {
        const offset = Math.sin((x / width) * Math.PI * 4 + Date.now() / 1200) * waveAmplitude;
        ctx.lineTo(x, height * 0.5 + offset);
      }
      ctx.strokeStyle = `rgba(94, 234, 212, ${0.2 + intensity * 0.4})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      const particles = particlesRef.current;
      particles.forEach((particle) => {
        particle.y -= particle.speed + intensity * 0.6;
        particle.x += Math.sin(Date.now() / 2000 + particle.phase) * 0.3;
        if (particle.y < -20) {
          particle.y = height + 20;
          particle.x = Math.random() * width;
        }
        ctx.fillStyle = `rgba(148, 163, 184, ${0.15 + intensity * 0.25})`;
        ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
      });

      if (isPlaying) {
        ctx.fillStyle = `rgba(56, 189, 248, ${0.08 + intensity * 0.2})`;
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, 180 + intensity * 60, 0, Math.PI * 2);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
};
