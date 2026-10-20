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

`scripts/measure-silhouette.ts` measures `reference/taste/captures/ascii-city-live.png` (kex) and the example's Playwright frame the same way over each image's cell grid and exits non-zero when the frame leaves the bounds it names from the capture, each bounded measure within ±30% of the capture's value. Against the frame without `Ascii` it also requires 0.6 of the cells crossed by one straight colour boundary to draw that boundary's tangent line, a measure the capture can't give, and it fails if a control that dims every ink pixel but each cell's brightest to grey 25 passes.

The settings check observes zero settings uploads over steady frames, one upload after changing `cellSize`, reuse of its buffer, and reuse of the render-pass descriptor. It is not a general heap-allocation oracle.
