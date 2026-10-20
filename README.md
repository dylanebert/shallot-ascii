# shallot-ascii

ascii rendering for [shallot](https://github.com/dylanebert/shallot).

```bash
bun add @dylanebert/shallot-ascii
```

```ts
// with AsciiPlugin in your app's plugins
world.add(camera, Ascii); // silhouette
world.add(camera, Ascii, { style: AsciiStyle.Filled });
```

See [`examples/ascii`](examples/ascii).

Silhouette draws coloured glyphs and edge lines on black, after [ASCII CITY](https://ascii-city-p1-k7m4k5.grownowgames.workers.dev/); filled paints every cell, after [asciicker](https://github.com/msokalski/asciicker). `cellSize` is in CSS pixels; `0` picks 8 for silhouette and 16 for filled. Glyphs are font8x8 (public domain). No terminal output.

| shallot-ascii | shallot |
| --- | --- |
| 0.1.0 | ^0.10.0 |

changing it: [`CONTRIBUTING.md`](CONTRIBUTING.md). mit.
