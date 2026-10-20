# Contributing

Use the Bun version in `.bun-version`, then `bun install`.

Run checks narrow to wide:

```sh
bun test tests/ramp.test.ts
bun test tests/scene.gpu.test.ts -t 'settings upload'
bun test tests/scene.gpu.test.ts
bun test tests/edges.gpu.test.ts
bun test ./examples/ascii/src/scene/scene.gpu.test.ts
bun test ./examples/ascii/tests/glyphs.node.ts
bunx playwright test -c examples/ascii --workers=1
bun scripts/measure-silhouette.ts <ascii-city-live.png> <frame.png> <frame-without-ascii.png>
bun check
bun run lint
bun run test
```

`examples/ascii` is a copied user project: `src/scene` owns the scene and its plugin check; `tests/glyphs.node.ts` checks the composed renderer's coloured 8-pixel glyph cells; `tests/ascii.e2e.ts` captures `ascii.png` through the stepped browser page. Run the example in a scratch copy with a package manifest installing a packed `@dylanebert/shallot-ascii`, published `@dylanebert/shallot@0.10.0`, `vite`, `@playwright/test`, and `webgpu` to check the consumer boundary independently of this workspace.

The GPU tests use headless Dawn through Shallot's public GPU testing helper (`webgpu`). On Linux install `mesa-vulkan-drivers` for software Vulkan, as CI does. No browser or window is needed.

The GPU oracle computes cell means, the colour-edge gate and angle, dithered luma selection and bitmap addressing independently from captured unprocessed pixels, and fails if a cell's decision sits within float rounding of a threshold. Keep its varied colours, partial edge cells, and no-component camera comparison when changing the pass. `tests/edges.gpu.test.ts` holds each straight boundary at 0°, 45°, 90° and 135° to one 8-connected run of its tangent glyph.

`scripts/measure-silhouette.ts` checks a silhouette frame against the same frame without `Ascii` for the ASCII CITY row's observables, on the example's cube and on Shallot's `examples/city` (copied from `v0.10.0` with the packed package) under one design. It requires: plain cells under luma 0.12 draw no ink; every ink pixel keeps its cell's chromaticity; cells at luma 0.2 or above draw ink; no flat face repeats one fill glyph more than 4 cells in a row; 0.6 of the cells crossed by one straight colour boundary draw that boundary's tangent line (coverage), and 0.6 of the cells drawing a box line are crossed cells (precision); edge ink is at least as bright as the brightest neighbouring fill. It fails if a control that dims every ink pixel but each cell's brightest to grey 25 passes. The ASCII CITY capture's image statistics (`reference/taste/captures/ascii-city-live.png` in kex) are recorded beside the frame's, measured the same way, and not bounded: they belong to the scene.

The settings check observes zero settings uploads over steady frames, one upload after changing `cellSize`, reuse of its buffer, and reuse of the render-pass descriptor. It is not a general heap-allocation oracle.
