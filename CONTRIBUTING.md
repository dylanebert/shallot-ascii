# Contributing

Use the Bun version in `.bun-version`, then `bun install`.

Run checks narrow to wide:

```sh
bun test tests/ramp.test.ts
bun test tests/scene.gpu.test.ts -t 'settings upload'
bun test tests/scene.gpu.test.ts
bun test ./examples/ascii/src/scene/scene.gpu.test.ts
bun test ./examples/ascii/tests/glyphs.node.ts
bunx playwright test -c examples/ascii --workers=1
bun check
bun run lint
bun run test
```

`examples/ascii` is a copied user project: `src/scene` owns the scene and its plugin check; `tests/glyphs.node.ts` checks the composed renderer's coloured 8-pixel glyph cells; `tests/ascii.e2e.ts` captures `ascii.png` through the stepped browser page. Run the example in a scratch copy with a package manifest installing a packed `@dylanebert/shallot-ascii`, published `@dylanebert/shallot@0.10.0`, `vite`, `@playwright/test`, and `webgpu` to check the consumer boundary independently of this workspace.

The GPU tests use headless Dawn through Shallot's public GPU testing helper (`webgpu`). On Linux install `mesa-vulkan-drivers` for software Vulkan, as CI does. No browser or window is needed.

The GPU oracle computes cell means, luma selection and bitmap addressing independently from captured unprocessed pixels. Keep its varied colours, partial edge cells, and no-component camera comparison when changing the pass.

The settings check observes zero settings uploads over steady frames, one upload after changing `cellSize`, reuse of its buffer, and reuse of the render-pass descriptor. It is not a general heap-allocation oracle.
