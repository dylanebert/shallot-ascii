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

After tonemapping, a reduction pass averages each cell's display-encoded RGB once into a one-texel-per-cell `rgba32float` texture, including only covered pixels in partial edge cells, and sums a Sobel colour structure tensor over the same pixels. A second pass reads those cells to draw the glyphs. The default `AsciiStyle.Silhouette` holds the ASCII CITY prototype's observables: a cell at Rec. 709 luma 0.12 or above whose tensor energy per cell row exceeds 0.02 draws the font8x8 box line along its colour edge (`─`, `╱`, `│`, `╲`, by the quantized gradient angle). Other cells at or above 0.12 take `clamp(floor(sqrt((luma - 0.12) / 0.88) * 8 + 3 * bayer), 0, 7)` of the ramp ` .:+*XZ0`, ordered by measured ink, where `bayer` is a 4×4 ordered dither in [-0.5, 0.5) by cell position. Cells below 0.12 are blank, so Shallot's `0x191816` clear colour (0.102) draws black. Each glyph's 8×8 bitmap is nearest-scaled over the full cell; partial edge cells clip it. Fill ink carries the cell's mean colour; an edge line carries that colour scaled to full brightness, so boundaries stay brighter than the fill. The background is black, and alpha is 1. `AsciiStyle.Filled` draws asciicker's auto-material cells. Removing `Ascii` restores normal camera presentation.

Only `Ascii`, `AsciiStyle` and `AsciiPlugin` are exported. The font data is public domain; see `src/font8x8-NOTICE`. This package does not provide terminal output.

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks.
