# Scroll Hero — Frame Sequence Handoff

**Branch**: `feat/scroll-video-hero` (PR #1)
**File to fix**: `frontend/src/components/ScrollExpansionVideoHero.tsx`
**Live broken preview**: https://enriched-uranium.vercel.app

The current `<video>.currentTime` scrubbing is broken (browsers snap to keyframes ~every 2s, so most scroll positions render the same frame). Replace it with a frame-sequence engine: extract the MP4 to JPEGs at build time, draw the active frame to a `<canvas>` on scroll. Apple does this on every product page.

---

## Do this in order

### 1. Install the build-time deps

```bash
cd frontend
npm install --save-dev @ffmpeg-installer/ffmpeg fluent-ffmpeg @types/fluent-ffmpeg
```

### 2. Create `frontend/scripts/extract-hero-frames.mjs`

```js
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(ROOT, 'public/videos/agentmesh-demo.mp4');
const OUT_DIR = resolve(ROOT, 'public/frames/agentmesh-demo');
const TARGET_FPS = 24;
const TARGET_WIDTH = 1280;
const JPEG_QUALITY = 4; // ffmpeg qscale: 1=best, 31=worst. 3-5 is the sweet spot.

if (!existsSync(SOURCE)) {
  console.error(`[hero-frames] missing source video: ${SOURCE}`);
  process.exit(1);
}

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

console.log(`[hero-frames] extracting ${SOURCE} -> ${OUT_DIR}`);

await new Promise((res, rej) => {
  ffmpeg(SOURCE)
    .outputOptions([
      `-vf scale=${TARGET_WIDTH}:-2,fps=${TARGET_FPS}`,
      `-qscale:v ${JPEG_QUALITY}`,
    ])
    .output(`${OUT_DIR}/%03d.jpg`)
    .on('end', res)
    .on('error', rej)
    .run();
});

const frames = readdirSync(OUT_DIR).filter((f) => f.endsWith('.jpg')).sort();
writeFileSync(
  `${OUT_DIR}/manifest.json`,
  JSON.stringify(
    {
      source: 'agentmesh-demo.mp4',
      count: frames.length,
      width: TARGET_WIDTH,
      fps: TARGET_FPS,
      pattern: '/frames/agentmesh-demo/{INDEX:03}.jpg',
    },
    null,
    2
  )
);
console.log(`[hero-frames] wrote ${frames.length} frames + manifest.json`);
```

### 3. Patch `frontend/package.json`

Replace the `build` script and add `frames`:

```json
"scripts": {
  "dev": "vite",
  "build": "node scripts/extract-hero-frames.mjs && vite build",
  "build:dev": "node scripts/extract-hero-frames.mjs && vite build --mode development",
  "lint": "eslint .",
  "preview": "vite preview",
  "frames": "node scripts/extract-hero-frames.mjs",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

### 4. Append to `frontend/.gitignore`

```
# Generated hero frames (regenerated from public/videos/agentmesh-demo.mp4 on every build)
public/frames/
```

### 5. Run the extraction once

```bash
cd frontend
npm run frames
```

Expected output: `[hero-frames] wrote 96 frames + manifest.json`. Verify with:

```bash
ls public/frames/agentmesh-demo
# 001.jpg ... 096.jpg manifest.json
```

If you get fewer frames than expected, check `TARGET_FPS` (24 × 4s clip = 96 frames).

### 6. Replace `frontend/src/components/ScrollExpansionVideoHero.tsx` entirely

Overwrite the file with this. The export name and the `Waypoint` interface are preserved so `Index.tsx` doesn't change.

```tsx
import { useEffect, useRef, useState } from 'react';
import { PlayCircle } from 'lucide-react';

export interface Waypoint {
  progress: number;
  title: string;
  caption?: string;
}

interface FrameManifest {
  count: number;
  width: number;
  fps: number;
  pattern: string;
}

interface ScrollExpansionVideoHeroProps {
  manifestUrl?: string;
  waypoints?: Waypoint[];
}

const DEFAULT_WAYPOINTS: Waypoint[] = [
  { progress: 0.00, title: 'One ask',          caption: 'A prompt arrives at the orchestrator.' },
  { progress: 0.33, title: 'Four delegations', caption: 'Specialists are summoned in parallel.' },
  { progress: 0.66, title: 'Lightning flows',  caption: 'Hashes and prompts stream both ways.' },
  { progress: 0.95, title: 'Done in seconds',  caption: 'Verified, settled, shipped.' },
];

const SECTION_HEIGHT_VH = 250;
const FALLBACK_STILL = '/frames/agentmesh-demo/001.jpg';

function frameUrl(pattern: string, index1Based: number) {
  return pattern.replace(/\{INDEX:(\d+)\}/, (_, w) =>
    String(index1Based).padStart(parseInt(w, 10), '0')
  );
}

export function ScrollExpansionVideoHero({
  manifestUrl = '/frames/agentmesh-demo/manifest.json',
  waypoints = DEFAULT_WAYPOINTS,
}: ScrollExpansionVideoHeroProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);

  const [manifest, setManifest] = useState<FrameManifest | null>(null);
  const [manifestFailed, setManifestFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lowEnd, setLowEnd] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(manifestUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('manifest 404'))))
      .then((m: FrameManifest) => { if (!cancelled) setManifest(m); })
      .catch(() => { if (!cancelled) setManifestFailed(true); });
    return () => { cancelled = true; };
  }, [manifestUrl]);

  useEffect(() => {
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(rm.matches);
    update();
    rm.addEventListener('change', update);

    const navAny = navigator as Navigator & { deviceMemory?: number };
    const memLow = typeof navAny.deviceMemory === 'number' && navAny.deviceMemory < 4;
    const widthLow = window.innerWidth < 768;
    setLowEnd(memLow || widthLow);

    return () => rm.removeEventListener('change', update);
  }, []);

  const useStatic = reducedMotion || lowEnd || manifestFailed;

  useEffect(() => {
    if (!manifest || useStatic) return;
    const imgs: HTMLImageElement[] = [];
    for (let i = 0; i < manifest.count; i++) {
      const img = new Image();
      img.decoding = 'async';
      img.src = frameUrl(manifest.pattern, i + 1);
      imgs.push(img);
    }
    imagesRef.current = imgs;
    return () => { imagesRef.current = []; };
  }, [manifest, useStatic]);

  useEffect(() => {
    if (!manifest || useStatic) return;

    let rafId = 0;
    let target = 0;
    let current = 0;
    const lerp = 0.2;

    const onScroll = () => {
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const moved = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      target = moved / Math.max(total, 1);
    };

    const draw = () => {
      const delta = target - current;
      current = Math.abs(delta) < 0.001 ? target : current + delta * lerp;
      setProgress(current);

      const canvas = canvasRef.current;
      const imgs = imagesRef.current;
      if (canvas && imgs.length) {
        const idx = Math.min(
          imgs.length - 1,
          Math.max(0, Math.round(current * (imgs.length - 1)))
        );
        const img = imgs[idx];
        if (img && img.complete && img.naturalWidth > 0) {
          if (canvas.width !== img.naturalWidth) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
          }
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0);
        }
      }
      rafId = requestAnimationFrame(draw);
    };

    onScroll();
    draw();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
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
      <div className={useStatic ? 'relative py-20 md:py-28' : 'sticky top-0 h-screen overflow-hidden'}>
        <div className="relative w-full h-full">
          {!useStatic && (
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-cover bg-black"
              aria-hidden
            />
          )}

          {useStatic && (
            <img
              src={FALLBACK_STILL}
              alt=""
              className="absolute inset-0 w-full h-full object-cover bg-black"
              aria-hidden
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          )}

          {useStatic && (
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
                        <h2 className="text-3xl md:text-6xl font-bold tracking-tight leading-[1.05]">{wp.title}</h2>
                        {wp.caption && (
                          <p className="mt-4 text-base md:text-lg text-muted-foreground max-w-2xl">{wp.caption}</p>
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
```

### 7. Smoke test locally

```bash
npm run dev
```

Open `http://localhost:8080`, scroll the hero section forward and back. Frames should advance smoothly from start to end with no sticking. Check Network tab — you should see ~96 JPEGs load in parallel, no `.mp4` fetched at runtime.

### 8. Lint + build

```bash
npm run lint
npm run build
npm run preview
```

All three must exit 0. The `build` step runs frame extraction first, so `dist/frames/agentmesh-demo/` will end up populated.

### 9. Commit + push

```bash
cd ..   # back to repo root
git add frontend/package.json frontend/package-lock.json frontend/.gitignore frontend/scripts/extract-hero-frames.mjs frontend/src/components/ScrollExpansionVideoHero.tsx
git commit -m "feat(scroll-hero): replace video.currentTime scrubbing with frame-sequence canvas engine"
git push origin feat/scroll-video-hero
```

PR #1 auto-updates.

### 10. Deploy to Vercel

```bash
cd frontend
vercel deploy --prod --yes
```

(Auto-deploy from GitHub may still be disconnected — fallback is the manual command above.)

### 11. Verify on prod

Open https://enriched-uranium.vercel.app and run the [acceptance checks](#acceptance-checks) below.

---

## Acceptance checks

Tick all of these before declaring done:

- [ ] **Forward scroll**: every frame from 001 → final visible during scroll, no sticking
- [ ] **Reverse scroll**: same smoothness backward
- [ ] **Endpoints reachable**: scrolled to 0% shows frame 001; scrolled to 100% shows the final frame (verify in DevTools Elements panel — canvas pixel data, or set a breakpoint on `idx`)
- [ ] **Reduced motion**: in DevTools → Rendering → Emulate CSS `prefers-reduced-motion: reduce`, page falls back to stacked waypoints over still frame 001
- [ ] **Low-end**: resize viewport < 768px width, same fallback kicks in
- [ ] **404 graceful**: temporarily rename `public/frames/agentmesh-demo/manifest.json` to break it, reload — fallback renders, no console errors
- [ ] **Total payload**: DevTools Network filter `frames/`, total size < 6 MB
- [ ] **No `<video>` left in the DOM**: search rendered HTML for `<video` — should return nothing
- [ ] **`npm run build` clean** locally and on Vercel

---

## If something breaks

| Symptom | Cause | Fix |
|---|---|---|
| `npm run frames` fails with `Cannot find module '@ffmpeg-installer/ffmpeg'` | Step 1 didn't run | `cd frontend && npm install` |
| Vercel build fails on extraction step | ffmpeg binary missing for the build platform | The `@ffmpeg-installer/ffmpeg` package ships a Linux binary; if it still fails, check Vercel's build log for permission errors and add `chmod +x` to the script |
| Canvas is blank on first scroll, then fills in | First-frame race — manifest loaded but images not yet decoded | Already handled by `img.complete && naturalWidth > 0` guard. If still blank, check DevTools Network tab to confirm frames are 200, not 404 |
| Scrub feels choppy on a fast laptop | Lerp factor too low, or React re-renders on every rAF | Verify `setProgress` is the only React state update in the rAF loop. If still choppy, raise `lerp` from `0.2` to `0.35` |
| Frames look stretched / aspect wrong | `object-fit: cover` not winning over canvas internal size | Canvas internal pixels (`canvas.width/height`) are set from image; CSS sizes the element. Both must coexist. The provided JSX is correct — don't add an explicit `width=` attribute to the canvas |
| Build artifact size > 10 MB | Too many frames or quality too high | Drop `TARGET_FPS` to 15 or raise `JPEG_QUALITY` qscale to 6. Re-run `npm run frames` and check `du -sh public/frames/agentmesh-demo` |

---

## Out of scope

- No new runtime dependencies (build-time only: `@ffmpeg-installer/ffmpeg`, `fluent-ffmpeg`)
- Don't touch `Index.tsx`, `Navbar`, routing, `lib/*`, `pages/Monitor.tsx`, `pages/Wallets.tsx`, or any backend wiring
- Don't rename the component or change its public API
- Don't replace the source MP4
- Don't edit `c:/Users/omark/.cursor/plans/video-prompt-and-model-pick_0aad4727.plan.md`

---

## Reference (only read if something doesn't match expectations)

**Why the existing `<video>.currentTime` approach is broken**
Browsers can only seek `<video>` to keyframes in the encoded H.264 stream. Veo and most consumer encoders place keyframes every 1–2 seconds. So setting `currentTime = 0.7` snaps to the keyframe at 0.5; setting it to `1.2` also snaps to 0.5; etc. Most scroll positions render the same frame. This is unfixable on the client without re-encoding the source with `-g 1` (keyframe every frame), which destroys compression. Use frames instead.

**Why the existing rAF lerp also asymptotes**
`current += (target - current) * 0.18` converges geometrically; `current` never reaches `target`. At full scroll, `current ≈ 0.999...`. Final frames unreachable. The replacement uses `current = Math.abs(delta) < 0.001 ? target : current + delta * lerp` to snap when close.

**Why frame sequences win**
Each scroll position maps to a distinct image. `Image.decode()` is ~5 ms for a 1280×720 JPEG. iOS Safari handles this perfectly while it's notoriously bad at `<video>` scrubbing. Total payload ~5 MB ≈ original MP4. Reverse scroll is trivially symmetric (frame index is an integer).

**Reference implementations**: Apple's product pages (e.g. AirPods Pro), Jo Mendes' Emergent demo at https://skeleton-rebuild.preview.emergentagent.com — both use this exact technique.

**Live preview of broken behavior**: https://enriched-uranium.vercel.app
**PR**: https://github.com/px404/EnrichedUranium/pull/1
**Source video**: `frontend/public/videos/agentmesh-demo.mp4` (4.28 MB, Veo 3.1, 4 seconds, 24fps — keep it, it's the source of truth)
