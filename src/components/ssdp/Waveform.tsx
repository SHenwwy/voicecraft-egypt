import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";

export function Waveform({ url, onReady }: { url: string; onReady?: (ws: WaveSurfer) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ws = WaveSurfer.create({
      container: ref.current,
      height: 56,
      waveColor: "rgba(150, 200, 255, 0.4)",
      progressColor: "hsl(var(--primary))",
      cursorColor: "hsl(var(--accent))",
      barWidth: 2,
      barGap: 2,
      barRadius: 2,
      url,
      normalize: true,
    });
    wsRef.current = ws;
    ws.on("ready", () => onReady?.(ws));
    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, [url, onReady]);

  return <div ref={ref} className="w-full rounded-md bg-secondary/40 px-2 py-1" />;
}
