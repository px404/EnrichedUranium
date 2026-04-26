# Scroll Hero — Frame Sequence Handoff

**Audience**: a fresh Claude Code session picking up the scroll-hero work.
**Status**: in-progress on branch `feat/scroll-video-hero`. Open PR: https://github.com/px404/EnrichedUranium/pull/1
**Live preview** (current broken behavior): https://enriched-uranium.vercel.app

> Read this whole doc top to bottom before touching code. The "Why my approach failed" section explains why the obvious solution (`<video>.currentTime`) doesn't work — repeating that mistake is the most likely failure mode for the next agent.

---

## 1. Goal

A scroll-driven hero on the homepage where, as the user scrolls through the section, a 4-second cinematic clip of an orchestrator delegating to four subagents plays back. **Forward and reverse scroll must both feel buttery and continuous** — no stutter, no stuck frames, no "it only plays the first 2 seconds." Reference behavior: https://skeleton-rebuild.preview.emergentagent.com (Jo Mendes' Emergent demo) and Apple's AirPods Pro product pages — both use frame sequences.

The video file is real and final: `frontend/public/videos/agentmesh-demo.mp4` (4.28 MB, generated via Veo 3.1, depicts the orchestration choreography).

---

## 2. Why my approach failed

The current code at `frontend/src/components/ScrollExpansionVideoHero.tsx` uses an HTML5 `<video>` element and binds:

```ts
video.currentTime = scrollProgress * video.duration;
```

This is the obvious solution and it doesn't work. Two independent bugs:

### Bug A — keyframe quantization (the dominant bug)

Browsers can only seek a `<video>` to **keyframes** in the encoded stream. A typical H.264 export from Veo or any consumer tool has a keyframe interval of 1–2 seconds. So when you set `currentTime = 0.7`, the browser snaps to the keyframe at 0.5 and renders that frame — for *every* scroll position between 0.5 and 1.5. The result: ~3 frames visible across an entire 4-second clip. Looks broken.

You **cannot** fix this from the client side. You'd need to re-encode the source video with a keyframe at every frame (`-g 1` in ffmpeg), which destroys compression and balloons the file 5–10x. At that point you're better off using actual frames.

### Bug B — rAF lerp asymptote

The current smoothing is:
```ts
current += (target - current) * 0.18;
```

Because lerp converges asymptotically, `current` never quite reaches `target`. At `target = 1.0` (full scroll) you stabilize around `current ≈ 0.999…`. So `video.currentTime = 0.999 * duration` — never the actual end. The final frames are unreachable. This is fixable (snap to target when |delta| < 0.001), but Bug A makes it irrelevant — even if `currentTime` were perfect, the browser wouldn't seek there anyway.

---

## 3. The right approach: frame sequence + canvas

**Pre-extract** the MP4 into a directory of JPEG frames at build time. **At runtime** the component loads all frames, tracks scroll, and on each scroll tick draws the appropriate frame onto a `<canvas>`. There is no `<video>` element involved at runtime.

Why this works:
- Each scroll position maps to a **distinct image** — no keyframe quantization
- `Image.decode()` is fast (~5 ms for a 1280×720 JPEG), faster than video seek
- Works identically on iOS Safari, which is notoriously bad at `<video>.currentTime` scrubbing
- Total payload is comparable to the MP4 (~5 MB of JPEGs ≈ one 4 MB MP4)
- Frame index is a pure integer — reverse scroll is trivially symmetric

This is exactly what Apple does on `apple.com/airpods-pro` (open DevTools → Network → filter `image` → watch the frame sequence load) and what every premium scroll-scrubbed product page does.

---

## 4. Acceptance criteria (test these before declaring done)

- [ ] Scrolling the hero section forward visibly steps through every frame from start to end with no visual sticking
- [ ] Scrolling reverse plays back symmetrically with the same smoothness
- [ ] At scroll progress 0%, frame 0 is rendered. At 100%, the final frame is rendered. Verify both with DevTools.
- [ ] Component falls back to a stacked-waypoint layout over a still hero image (frame 0) when:
  - `prefers-reduced-motion: reduce` is set
  - `navigator.deviceMemory < 4` OR `window.innerWidth < 768`
  - The frames directory 404s (graceful degrade)
- [ ] Frame extraction runs as part of `npm run build` (so Vercel auto-extracts on deploy)
- [ ] Frame extraction works on Linux (Vercel's build env) AND on Windows (the developer's machine)
- [ ] No new entries in `frontend/.gitignore` are missing — the `frames/` directory should NOT be committed (it's regenerated from the MP4)
- [ ] Total transfer size of the hero section < 6 MB (sum of all loaded JPEGs)
- [ ] First-paint perceived hero image renders within ~300 ms — preload the first frame as `<link rel="preload">`
- [ ] `npm run lint` clean
- [ ] `npm run build` clean on both Windows local and Vercel
- [ ] The existing `<ScrollExpansionVideoHero />` import in `src/pages/Index.tsx` line 100 keeps working unchanged. **Do not** rename the component or change its public API.

---

## 5. File plan

```
frontend/
├── public/
│   ├── videos/
│   │   └── agentmesh-demo.mp4          # KEEP — source of truth
│   └── frames/
│       └── agentmesh-demo/             # NEW — gitignored, regenerated
│           ├── 000.jpg
│           ├── 001.jpg
│           ├── …
│           └── 095.jpg
├── scripts/
│   └── extract-hero-frames.mjs         # NEW
├── src/
│   └── components/
│       └── ScrollExpansionVideoHero.tsx # REWRITE internals, keep export name
├── package.json                        # add prebuild + ffmpeg deps
└── .gitignore                          # add public/frames/
```

---

## 6. Implementation steps

### 6.1 Install ffmpeg deps

```bash
cd frontend
npm install --save-dev @ffmpeg-installer/ffmpeg fluent-ffmpeg
npm install --save-dev --save-exact @types/fluent-ffmpeg
```

`@ffmpeg-installer/ffmpeg` ships a precompiled ffmpeg binary for the host platform (Linux on Vercel, Windows locally). Zero config. Adds ~80 MB to `node_modules` but `node_modules` isn't committed.

### 6.2 Extraction script

`frontend/scripts/extract-hero-frames.mjs`:

```js
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffmpeg from 'fluent-ffmpeg';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SOURCE = resolve(ROOT, 'public/videos/agentmesh-demo.mp4');
const OUT_DIR = resolve(ROOT, 'public/frames/agentmesh-demo');
const TARGET_FPS = 24;            // tune: more frames = smoother + bigger payload
const TARGET_WIDTH = 1280;        // 720p hero is plenty for retina; downscale aggressively
const JPEG_QUALITY = 4;           // ffmpeg's qscale: 1=best, 31=worst. 3-5 is the sweet spot.

if (!existsSync(SOURCE)) {
  console.error(`[hero-frames] missing source video: ${SOURCE}`);
  process.exit(1);
}

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

console.log(`[hero-frames] extracting ${SOURCE} → ${OUT_DIR}`);

await new Promise((resolveP, rejectP) => {
  ffmpeg(SOURCE)
    .outputOptions([
      `-vf scale=${TARGET_WIDTH}:-2,fps=${TARGET_FPS}`,
      `-qscale:v ${JPEG_QUALITY}`,
    ])
    .output(`${OUT_DIR}/%03d.jpg`)
    .on('end', resolveP)
    .on('error', rejectP)
    .run();
});

const frames = readdirSync(OUT_DIR).filter((f) => f.endsWith('.jpg')).sort();
console.log(`[hero-frames] wrote ${frames.length} frames`);

// Emit a manifest the component can read so frame count isn't hardcoded
const manifest = {
  source: 'agentmesh-demo.mp4',
  count: frames.length,
  width: TARGET_WIDTH,
  fps: TARGET_FPS,
  pattern: '/frames/agentmesh-demo/{INDEX:03}.jpg',
};
const { writeFileSync } = await import('node:fs');
writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
```

Notes:
- ffmpeg renames frames `001.jpg`, `002.jpg`, … (1-indexed). The component should treat indices as 0-based and add 1 when constructing URLs, OR the script should be tweaked to start at 000. Pick one and be consistent.
- A 4-second video at 24fps = 96 frames. At 1280×720 with qscale 4 each frame is ~50 KB → ~5 MB total. Adjust `TARGET_FPS` down to 15 if you need to trim payload.
- `manifest.json` lets the component read `count` at runtime instead of hardcoding 96.

### 6.3 Wire into package.json

```diff
   "scripts": {
     "dev": "vite",
-    "build": "vite build",
+    "build": "node scripts/extract-hero-frames.mjs && vite build",
     "build:dev": "vite build --mode development",
     "lint": "eslint .",
     "preview": "vite preview",
+    "frames": "node scripts/extract-hero-frames.mjs",
     "test": "vitest run",
     "test:watch": "vitest"
   },
```

`prebuild` would also work but Vercel doesn't always run npm lifecycle hooks the way you expect; chaining inside `build` is the bulletproof option.

### 6.4 Update .gitignore

```diff
+# Generated hero frames (regenerated from public/videos/agentmesh-demo.mp4 on every build)
+public/frames/
```

The MP4 is committed; the frames are not. Single source of truth.

### 6.5 Component rewrite

Keep the file path (`frontend/src/components/ScrollExpansionVideoHero.tsx`), keep the export name (`ScrollExpansionVideoHero`), keep the `Waypoint` interface and `DEFAULT_WAYPOINTS` so `Index.tsx` doesn't change.

Replace the internals with the canvas + frame-sequence engine. Key parts:

```tsx
import { useEffect, useRef, useState } from 'react';

// … keep Waypoint interface and DEFAULT_WAYPOINTS …

const MANIFEST_URL = '/frames/agentmesh-demo/manifest.json';
const SECTION_HEIGHT_VH = 250;

interface FrameManifest {
  count: number;
  width: number;
  fps: number;
  pattern: string;
}

function frameUrlFromPattern(pattern: string, index: number) {
  // pattern looks like '/frames/agentmesh-demo/{INDEX:03}.jpg'
  return pattern.replace(/\{INDEX:(\d+)\}/, (_, w) =>
    String(index + 1).padStart(parseInt(w, 10), '0')
  );
}

function useFrameSequence(manifest: FrameManifest | null) {
  const imagesRef = useRef<HTMLImageElement[]>([]);
  const [readyCount, setReadyCount] = useState(0);

  useEffect(() => {
    if (!manifest) return;
    const imgs: HTMLImageElement[] = [];
    let cancelled = false;
    let loaded = 0;
    for (let i = 0; i < manifest.count; i++) {
      const img = new Image();
      img.decoding = 'async';
      img.src = frameUrlFromPattern(manifest.pattern, i);
      img.onload = () => {
        if (cancelled) return;
        loaded += 1;
        setReadyCount(loaded);
      };
      img.onerror = () => {
        if (cancelled) return;
        loaded += 1;
        setReadyCount(loaded);
      };
      imgs.push(img);
    }
    imagesRef.current = imgs;
    return () => { cancelled = true; };
  }, [manifest]);

  return { images: imagesRef, readyCount };
}

export function ScrollExpansionVideoHero({
  waypoints = DEFAULT_WAYPOINTS,
}: ScrollExpansionVideoHeroProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [manifest, setManifest] = useState<FrameManifest | null>(null);
  const [manifestFailed, setManifestFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lowEnd, setLowEnd] = useState(false);

  // Load manifest
  useEffect(() => {
    fetch(MANIFEST_URL)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setManifest)
      .catch(() => setManifestFailed(true));
  }, []);

  // Reduced motion + low-end detect (same as before)
  useEffect(() => { /* … */ }, []);

  const { images, readyCount } = useFrameSequence(manifest);

  const useStatic = reducedMotion || lowEnd || manifestFailed;

  // Scroll → progress (pure rAF, snap to target if close)
  useEffect(() => {
    if (useStatic || !manifest) return;
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
      if (canvas && manifest && images.current.length) {
        const idx = Math.min(
          manifest.count - 1,
          Math.max(0, Math.round(current * (manifest.count - 1)))
        );
        const img = images.current[idx];
        if (img && img.complete && img.naturalWidth > 0) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            // Match canvas internal size to image once, then drawImage stretches
            if (canvas.width !== img.naturalWidth) {
              canvas.width = img.naturalWidth;
              canvas.height = img.naturalHeight;
            }
            ctx.drawImage(img, 0, 0);
          }
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
  }, [manifest, useStatic, images]);

  // Render: section ref, sticky inner, canvas full-bleed, waypoints absolutely positioned with computed opacity
  // (reuse the existing JSX layout from the current component for the section + waypoints + scroll bar)
  // Replace the <video> tag with <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
  // …
}
```

Critical implementation notes:
- **Don't `setState` inside the rAF loop for the canvas draw** — drawing to canvas is a side effect that doesn't need React reconciliation. Only `setProgress` if the waypoint opacity computation needs it. (You could even drop the `setProgress` call and compute waypoint opacity from `current` directly with a separate state-less mechanism, but `setProgress` is simpler and runs at most ~60fps.)
- **Preload the first frame** for fast initial paint. Add a `<link rel="preload" as="image" href="/frames/agentmesh-demo/001.jpg">` in `index.html` or via React.
- **Use `object-fit: cover`** semantics on the canvas: set canvas internal size to match the image (`naturalWidth × naturalHeight`), then CSS-stretch it to fill the container (`width:100%; height:100%; object-fit:cover`).
- **Don't worry about progressive frame loading.** All frames are ~50 KB; a fast connection grabs all 96 in parallel in <2s. On a slow connection, the user sees frame 0 (the still) until frames load — that's fine.

### 6.6 Static fallback

For `useStatic === true`: render `<img src="/frames/agentmesh-demo/001.jpg">` as a still hero, stack the four waypoints below as separate text blocks, no scroll-scrub. Same as the current component does for the static branch.

### 6.7 Cleanup

Once the new implementation is verified live, **delete or comment out the old `<video>`-based render path**. Don't leave both behind.

---

## 7. Performance budget

| Metric | Target | How to verify |
|---|---|---|
| Total transferred bytes for hero | < 6 MB | DevTools Network panel, filter `frames/` |
| First Contentful Paint | < 1.2 s | Lighthouse |
| Frame count | 60–96 | `manifest.json` |
| Per-frame size | < 80 KB | `ls -lah public/frames/agentmesh-demo/` |
| Scroll FPS during scrub | 60 | DevTools Performance recording while scrolling |
| Build time impact | < 15 s extra | `npm run build` timing before vs after |

If any of these blow out, the levers are: lower `TARGET_FPS` (24 → 15), lower `TARGET_WIDTH` (1280 → 960), raise `JPEG_QUALITY` qscale value (4 → 6).

---

## 8. Files to read before touching code

In order:

1. `frontend/src/components/ScrollExpansionVideoHero.tsx` — the broken implementation. Skim it, understand the waypoint copy (`One ask` / `Four delegations` / `Lightning flows` / `Done in seconds`), and notice it must keep its export name.
2. `frontend/src/pages/Index.tsx` line 100 — the integration point. Don't change it.
3. `frontend/src/index.css` — design tokens (`--surface`, `--border`, `--primary`, `--primary-glow`). Reuse these for any new styling.
4. `c:/Users/omark/.cursor/plans/video-prompt-and-model-pick_0aad4727.plan.md` — the plan file with the Veo prompt and original kit-spec behavior list. Do **not** edit this file.
5. https://github.com/px404/EnrichedUranium/pull/1 — current state of the branch.

---

## 9. Repo + deployment context

- Active repo: `https://github.com/px404/EnrichedUranium` (the React app is at `frontend/`)
- Working branch: `feat/scroll-video-hero` — push fix commits here, the PR auto-updates
- Pixel-perfect repo (`https://github.com/omarjku/pixel-perfect`): the original repo before the monorepo move; mirror commits there if convenient, otherwise focus on EnrichedUranium
- Vercel project: `enriched-uranium` (team `omars-projects-d8464da7`), live at https://enriched-uranium.vercel.app
- Vercel ↔ GitHub auto-deploy: NOT YET CONNECTED at time of writing. Owner needs to grant the Vercel GitHub app access to `px404` org. Until then, deploys are manual via `vercel deploy --prod --yes` from `frontend/`.

---

## 10. Out of scope

- Three.js / WebGL — the hero must be a 2D canvas drawing image frames. No 3D.
- Touching the teammate's backend wiring (`frontend/src/lib/{api,adapters,identity,keypair}.ts` or `frontend/src/pages/{Monitor,Wallets}.tsx`)
- Replacing the video file
- Renaming the component or changing its public props
- Editing the plan file at `c:/Users/omark/.cursor/plans/video-prompt-and-model-pick_0aad4727.plan.md`
- Adding any new runtime dependency. Build-time deps (`@ffmpeg-installer/ffmpeg`, `fluent-ffmpeg`) only.

---

## 11. Open questions to confirm with the user before merging

1. Frame budget — 96 frames at 24fps gives the smoothest scrub but ~5 MB. Cut to 60 frames at 15fps and it's ~3 MB but slightly less smooth. Default to 24fps unless they ask.
2. Should the hero section's outer height stay at 250vh, or tighten to 200vh now that the video is a known 4-second clip? Try both, pick what feels right.
3. After this lands, do they want the first frame to be a designed poster (still illustration) or just frame 0 of the video? Default to frame 0 for now — they can swap to a custom poster later by replacing the file.

---

## 12. Definition of done

- `npm run build` works on Windows local
- Vercel production deploy works (verify https://enriched-uranium.vercel.app shows the new behavior)
- Scrolling forward and backward both feel smooth, every frame is reachable, no sticking
- All three fallback paths (reduced-motion / low-end / 404) tested in DevTools
- PR #1 description updated with a screenshot or short video of the working scrub
- Old `<video>`-based code removed from the component
- `.gitignore` includes `public/frames/`
- This handoff doc gets a final commit moving its status from "in-progress" to "done", or gets deleted if you'd rather not retain it
