# OpenBoard performance suite

Run: `npm run test:perf` (not part of `npm test`). `PERF_STRICT=1 npm run test:perf` enforces the exact budgets;
by default every budget is multiplied by 3 so shared CI runners do not flake. Results (median, all runs, budget,
machine info) are written to `test/perf/results/latest.json` (gitignored) for trend tracking.

## What the automated suite measures (Node, no browser)

| Test | Req | Measurement | Budget |
|---|---|---|---|
| `open.perf.ts` | 2.1, 17.1 | Parser + `toReactFlow` projection + culling for 1/3/5 MB boards and a 5,000-element board, median of 5 | 2 s (5 MB), 3 s (5,000 el) |
| `open.perf.ts` | 17.5, 17.6 | Notice threshold: 5,000 elements open without notice, 5,001 open with the large-board notice flag | functional |
| `batch.perf.ts` | 17.4 | `openboard.batch` creating 1,000 Elements (500 ops x 2), median of 5 | 5 s |
| `activation.perf.ts` | 1.7 | Proxy: cold import of the registry composition module + full tool registry construction (no `vscode` fake exists) | 2000 ms |
| `frame.perf.ts` | 3.13 | Per-frame CPU cost of pan/zoom state update + projection + culling, 1,000 elements | 33.3 ms |
| `frame.perf.ts` | 17.3 | Per-frame CPU cost of drag preview recompute + projection + snapping, 200 selected elements | 33.3 ms |

These are **proxies**. They exclude DOM, ReactFlow layout/paint, GPU compositing, the webview message hop and the
VS Code extension host. They catch algorithmic regressions in the pure core; they do not prove 30 fps.

## What must be measured manually on the reference machine (design.md, "Reference Machine")

4-core ~3 GHz, 8 GB, integrated GPU with hardware acceleration, 1920x1080 at 1x, webview >= 1200x800, SSD, network off,
no other extensions. Windows 11, macOS 13+ and Ubuntu 22.04; the lowest result must pass.

1. **Activation (1.7):** `Developer: Show Running Extensions` shows the activation time; or log `performance.now()` at the
   top of `activate()` and when its promise resolves. Median of 10 cold starts (restart the window each time). Target < 2000 ms.
2. **Open time (2.1, 17.1):** generate fixtures with `generateBoard` from `fixtures.ts` (write `.text` to a `.openboard` file;
   1 MB to 5 MB and 5,000 elements). Time from `openCustomDocument` to the first `requestAnimationFrame` after ReactFlow
   `onInit` with in-viewport nodes mounted. Median of 5. Targets: 5 MB < 2 s, 5,000 elements < 3 s.
3. **FPS (3.13, 17.3):** in the webview devtools (`Developer: Open Webview Developer Tools`) paste this harness, with the
   1,000-element board open for pan/zoom and a 200-element selection for drag:

   ```js
   // Usage: await measureFps(() => stepFn(t), 10000)   // stepFn dispatches one synthetic pointer/wheel step
   async function measureFps(step, ms = 10000) {
     const start = performance.now(); let frames = 0;
     await new Promise((done) => {
       const tick = (now) => { step(now - start); frames++; now - start < ms ? requestAnimationFrame(tick) : done(); };
       requestAnimationFrame(tick);
     });
     return frames / ((performance.now() - start) / 1000);
   }
   // Pan/zoom: dispatch WheelEvent (ctrlKey for zoom) and pointer drags on `.react-flow__pane`.
   // Drag: dispatch pointerdown on a selected node, then pointermove with a Lissajous path, then pointerup.
   ```
   Pass: average >= 30 fps over the 10 s run. Record the number in the PR or trend sheet.
4. **Batch (17.4):** the automated test runs the real `openboard.batch` core path; on the reference machine also call it
   through `vscode.lm.invokeTool` once to include IDE overhead.

`jsdom` is installed for component tests but has no layout or paint, so it cannot measure real fps; do not use it for 3.13 / 17.3.
