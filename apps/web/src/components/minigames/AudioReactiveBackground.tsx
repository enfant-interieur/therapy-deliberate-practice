import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

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

export const AudioReactiveBackground = ({
  audioElement,
  isPlaying,
}: AudioReactiveBackgroundProps) => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | undefined>(undefined);

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
      const count = Math.min(
        900,
        Math.max(400, Math.floor(window.innerWidth / 2)),
      );
      particlesRef.current = Array.from({ length: count }).map(() => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        size: 1 + Math.random() * 2,
        speed: 0.1 + Math.random() * 0.4,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!audioElement || audioContextRef.current) return;
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const source = audioContext.createMediaElementSource(audioElement);
    source.connect(analyser);
    analyser.connect(audioContext.destination);
    analyserRef.current = analyser;
    dataRef.current = new Uint8Array(analyser.frequencyBinCount);
    audioContextRef.current = audioContext;
    return () => {
      source.disconnect();
      analyser.disconnect();
      analyserRef.current = null;
      dataRef.current = null;
      audioContextRef.current = null;
      void audioContext.close().catch(() => undefined);
    };
  }, [audioElement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const draw = (timestamp = 0) => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      ctx.clearRect(0, 0, width, height);

      const analyser = analyserRef.current;
      const dataArray = dataRef.current;
      let intensity = 0.2;
      if (analyser && dataArray) {
        analyser.getByteFrequencyData(dataArray);
        const avg =
          dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
        intensity = Math.min(1, avg / 200);
      }

      ctx.fillStyle = "rgba(10, 20, 36, 0.6)";
      ctx.fillRect(0, 0, width, height);

      const waveAmplitude = 20 + intensity * 80;
      ctx.beginPath();
      ctx.moveTo(0, height * 0.5);
      for (let x = 0; x <= width; x += 20) {
        const offset =
          Math.sin(
            (x / width) * Math.PI * 4 +
              (prefersReducedMotion ? 0 : timestamp / 1200),
          ) * waveAmplitude;
        ctx.lineTo(x, height * 0.5 + offset);
      }
      ctx.strokeStyle = `rgba(94, 234, 212, ${0.2 + intensity * 0.4})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      const particles = particlesRef.current;
      particles.forEach((particle) => {
        if (!prefersReducedMotion) {
          particle.y -= particle.speed + intensity * 0.6;
          particle.x += Math.sin(timestamp / 2000 + particle.phase) * 0.3;
          if (particle.y < -20) {
            particle.y = height + 20;
            particle.x = Math.random() * width;
          }
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

      if (!prefersReducedMotion) {
        rafRef.current = requestAnimationFrame(draw);
      }
    };

    if (prefersReducedMotion) {
      draw();
    } else {
      rafRef.current = requestAnimationFrame(draw);
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-motion={prefersReducedMotion ? "reduced" : "full"}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
};
