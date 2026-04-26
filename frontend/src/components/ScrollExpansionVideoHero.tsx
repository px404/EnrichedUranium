import { useEffect, useRef, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import {
  drawImageCover,
  frameIndexForProgress,
  frameUrl,
  type FrameManifest,
} from './scrollExpansionFrames';

export interface Waypoint {
  progress: number;
  title: string;
  caption?: string;
}

interface ScrollExpansionVideoHeroProps {
  videoSrc?: string;
  posterSrc?: string;
  manifestSrc?: string;
  waypoints?: Waypoint[];
}

const DEFAULT_WAYPOINTS: Waypoint[] = [
  { progress: 0.00, title: 'One request enters the network', caption: 'A single prompt arrives at the platform core.' },
  { progress: 0.34, title: 'The platform routes the prompt', caption: 'The orchestrator opens the path to the prompt router.' },
  { progress: 0.67, title: 'Specialists execute in parallel', caption: 'Vision, parse, write, and verify agents light up together.' },
  { progress: 0.95, title: 'Settled, verified, connected', caption: 'Sats, receipts, and results move through one shared agent network.' },
];

const SECTION_HEIGHT_VH = 250;
const DEFAULT_MANIFEST_SRC = '/frames/agentmesh-demo/manifest.json';
const FALLBACK_STILL = '/frames/agentmesh-demo/001.jpg';

export function ScrollExpansionVideoHero({
  manifestSrc = DEFAULT_MANIFEST_SRC,
  waypoints = DEFAULT_WAYPOINTS,
}: ScrollExpansionVideoHeroProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const manifestRef = useRef<FrameManifest | null>(null);
  const [progress, setProgress] = useState(0);
  const [manifest, setManifest] = useState<FrameManifest | null>(null);
  const [framesReady, setFramesReady] = useState(false);
  const [framesFailed, setFramesFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lowEnd, setLowEnd] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFramesFailed(false);

    fetch(manifestSrc)
      .then((response) => {
        if (!response.ok) throw new Error(`Frame manifest failed: ${response.status}`);
        return response.json() as Promise<FrameManifest>;
      })
      .then((nextManifest) => {
        if (cancelled) return;
        manifestRef.current = nextManifest;
        setManifest(nextManifest);
      })
      .catch(() => {
        if (!cancelled) setFramesFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [manifestSrc]);

  useEffect(() => {
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(rm.matches);
    update();
    rm.addEventListener('change', update);

    const navAny = navigator as Navigator & { deviceMemory?: number };
    const mem = navAny.deviceMemory;
    const memLow = typeof mem === 'number' && mem < 4;
    const widthLow = window.innerWidth < 768;
    setLowEnd(memLow || widthLow);

    return () => rm.removeEventListener('change', update);
  }, []);

  const useStatic = reducedMotion || lowEnd || framesFailed;

  useEffect(() => {
    if (!manifest || useStatic) return;

    let cancelled = false;
    let loaded = 0;
    const images = Array.from({ length: manifest.count }, (_, index) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = frameUrl(manifest.pattern, index);
      img.onload = () => {
        if (cancelled) return;
        loaded += 1;
        if (loaded >= Math.min(6, manifest.count)) {
          setFramesReady(true);
        }
      };
      img.onerror = () => {
        if (!cancelled) setFramesFailed(true);
      };
      return img;
    });

    imagesRef.current = images;

    return () => {
      cancelled = true;
      imagesRef.current = [];
      setFramesReady(false);
    };
  }, [manifest, useStatic]);

  useEffect(() => {
    if (useStatic || !manifest) return;

    const setCanvasSize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        return true;
      }
      return false;
    };

    let rafId = 0;
    let target = 0;
    let current = 0;
    let lastDrawn = -1;

    const onScroll = () => {
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const viewH = window.innerHeight;
      const total = rect.height - viewH;
      const moved = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      target = moved / Math.max(total, 1);
    };

    const tick = () => {
      const delta = target - current;
      current = Math.abs(delta) < 0.001 ? target : current + delta * 0.2;
      setProgress(current);

      const canvas = canvasRef.current;
      const imageIndex = frameIndexForProgress(current, manifest.count);
      const image = imagesRef.current[imageIndex];

      if (canvas && image && image.complete && image.naturalWidth > 0) {
        const resized = setCanvasSize();
        const ctx = canvas.getContext('2d');
        if (ctx && (resized || imageIndex !== lastDrawn)) {
          drawImageCover(ctx, image, canvas.width, canvas.height);
          lastDrawn = imageIndex;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    setCanvasSize();
    onScroll();
    tick();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', setCanvasSize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', setCanvasSize);
    };
  }, [manifest, useStatic]);

  const computeOpacity = (idx: number) => {
    const wp = waypoints[idx];
    const next = waypoints[idx + 1];
    const start = wp.progress;
    const end = next ? next.progress : 1.0;
    const fadeBand = 0.05;

    if (progress < start - fadeBand) return 0;
    if (progress < start) return (progress - (start - fadeBand)) / fadeBand;
    if (progress < end - fadeBand) return 1;
    if (progress < end) return Math.max(0, 1 - (progress - (end - fadeBand)) / fadeBand);
    return idx === waypoints.length - 1 ? 1 : 0;
  };

  return (
    <section
      ref={sectionRef}
      id="scroll-expansion-hero"
      className="relative border-y border-border bg-background"
      style={{ height: useStatic ? 'auto' : `${SECTION_HEIGHT_VH}vh` }}
      aria-label="Scroll-controlled product demo"
    >
      <div className={useStatic
        ? 'relative py-20 md:py-28'
        : 'sticky top-0 h-screen overflow-hidden'}>
        <div className="relative w-full h-full">
          {!useStatic && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-cover bg-black"
              aria-hidden
            />
          )}

          {!useStatic && !framesReady && (
            <img
              src={FALLBACK_STILL}
              alt=""
              className="absolute inset-0 w-full h-full object-cover bg-black"
              aria-hidden
            />
          )}

          {useStatic && (
            <>
              <img
                src={FALLBACK_STILL}
                alt=""
                className="absolute inset-0 w-full h-full object-cover bg-black"
                aria-hidden
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'radial-gradient(ellipse at 30% 20%, hsl(205 90% 68% / 0.18), transparent 50%),' +
                    'radial-gradient(ellipse at 70% 80%, hsl(205 90% 68% / 0.12), transparent 55%),' +
                    'linear-gradient(180deg, hsl(0 0% 5%), hsl(0 0% 3%))',
                }}
                aria-hidden
              />
            </>
          )}

          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'linear-gradient(180deg, hsl(0 0% 4% / 0.55) 0%, hsl(0 0% 4% / 0.15) 35%, hsl(0 0% 4% / 0.25) 65%, hsl(0 0% 4% / 0.85) 100%)',
            }}
            aria-hidden
          />

          {useStatic ? (
            <div className="container relative">
              <div className="max-w-3xl space-y-14">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium">
                  <PlayCircle className="h-3.5 w-3.5" />
                  Immersive product demo
                </div>
                {waypoints.map((wp, i) => (
                  <div key={i} className="motion-fade-up">
                    <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">
                      {String(i + 1).padStart(2, '0')} / {String(waypoints.length).padStart(2, '0')}
                    </div>
                    <h2 className="text-3xl md:text-5xl font-bold tracking-tight">{wp.title}</h2>
                    {wp.caption && (
                      <p className="mt-3 text-base text-muted-foreground max-w-2xl">{wp.caption}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="container relative h-full flex items-center">
              <div className="w-full max-w-3xl">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary text-xs font-medium mb-8 backdrop-blur-sm">
                  <PlayCircle className="h-3.5 w-3.5" />
                  Immersive product demo
                </div>
                <div className="relative min-h-[40vh] md:min-h-[44vh]">
                  {waypoints.map((wp, i) => {
                    const opacity = computeOpacity(i);
                    if (opacity <= 0.001) return null;
                    return (
                      <div
                        key={i}
                        className="absolute inset-x-0 top-0 will-change-[opacity,transform]"
                        style={{
                          opacity,
                          transform: `translateY(${(1 - opacity) * 14}px)`,
                          transition: 'opacity 60ms linear',
                        }}
                      >
                        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                          {String(i + 1).padStart(2, '0')} / {String(waypoints.length).padStart(2, '0')}
                        </div>
                        <h2 className="text-3xl md:text-6xl font-bold tracking-tight leading-[1.05]">
                          {wp.title}
                        </h2>
                        {wp.caption && (
                          <p className="mt-4 text-base md:text-lg text-muted-foreground max-w-2xl">
                            {wp.caption}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {!useStatic && (
            <div className="absolute bottom-6 left-0 right-0 pointer-events-none">
              <div className="container">
                <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                  <span>Scroll</span>
                  <div className="flex-1 h-px bg-border/80 relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-primary"
                      style={{ width: `${Math.min(100, progress * 100)}%` }}
                    />
                  </div>
                  <span className="tabular-nums">{String(Math.round(progress * 100)).padStart(2, '0')}%</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
