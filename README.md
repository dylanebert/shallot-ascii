# shallot-ascii

Bitmap ASCII post-processing for Shallot 0.10. A camera opts in; other cameras keep core presentation.

```sh
bun add @dylanebert/shallot @dylanebert/shallot-ascii
```

Add `AsciiPlugin` to your app's `plugins` array (or your game plugin's `dependencies`), then opt in an existing camera during initialization:

```ts
import { Ascii, AsciiPlugin } from "@dylanebert/shallot-ascii";

// App configuration: plugins: [/* your other plugins, */ AsciiPlugin]
// In your game's initialize(world), after creating its camera:
world.add(camera, Ascii); // default: { cellSize: 8 }
```

`AsciiPlugin` depends on Shallot's core pipeline. `Ascii.cellSize` is an integer number of physical target pixels (minimum 1), not CSS pixels.

The after-tonemapping pass averages each cell's display-encoded RGB, including only covered pixels in partial edge cells. Rec. 709 luma selects `min(floor(luma * rampLength), rampLength - 1)`. The ramp contains printable basic Latin font8x8 glyphs, sorted by measured ink (code point breaks ties), blank first. Each glyph's 8×8 bitmap is nearest-scaled over the full cell; partial edge cells clip it. Ink carries the cell mean colour, background is black, and alpha is 1. Removing `Ascii` restores normal camera presentation.

Only `Ascii` and `AsciiPlugin` are exported. The font data is public domain; see `src/font8x8-NOTICE`. This package does not provide terminal output or directional/edge glyph selection.

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks.
