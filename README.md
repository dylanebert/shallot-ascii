# shallot-ascii

Bitmap ASCII post-processing for Shallot 0.10. A camera opts in; other cameras keep core presentation.

```sh
bun add @dylanebert/shallot @dylanebert/shallot-ascii
```

Add `AsciiPlugin` to your app's `plugins` array (or your game plugin's `dependencies`), then opt in an existing camera during initialization:

```ts
import { Ascii, AsciiPlugin, AsciiStyle } from "@dylanebert/shallot-ascii";

// App configuration: plugins: [/* your other plugins, */ AsciiPlugin]
// In your game's initialize(world), after creating its camera:
world.add(camera, Ascii); // default: { cellSize: 0, style: AsciiStyle.Silhouette }
// or: world.add(camera, Ascii, { style: AsciiStyle.Filled });
```

`AsciiPlugin` depends on Shallot's core pipeline. Cells use whole font8x8 glyph scales in device pixels, sized from CSS pixels (ratio 1 for texture targets). The default `cellSize: 0` gives silhouette 8 CSS pixels; filled follows asciicker's display-diagonal sizing, choosing among 8–40 device pixels while keeping at least a 45×36 grid and drawing at most 160×90 cells. A positive `cellSize` overrides either style in CSS pixels, rounded to the nearest whole glyph scale.

After tonemapping, a reduction pass averages each cell's display-encoded RGB once into a one-texel-per-cell `rgba32float` texture, including only covered pixels in partial edge cells, and fits its pixels' colours with each straight split along columns, rows and both diagonals of its 8×8 scaled coordinates. A second pass reads those cells to draw the glyphs. The default `AsciiStyle.Silhouette` holds the ASCII CITY prototype's observables: a cell at Rec. 709 luma 0.12 or above whose best split explains at least 0.56 of its colour variance, with sides at least 0.1 apart in RGB and each at least a row of pixels, draws the font8x8 box line along that split (`│`, `─`, `╱`, `╲`). Clutter within a cell averages out across any one split, so it draws fill. Other cells at or above 0.12 take `clamp(floor(sqrt((luma - 0.12) / 0.88) * 8 + 3 * bayer), 0, 7)` of the ramp ` .:+*XZ0`, ordered by measured ink, where `bayer` is a 4×4 ordered dither in [-0.5, 0.5) by cell position. Cells below 0.12 are blank, so Shallot's `0x191816` clear colour (0.102) draws black. Each glyph's 8×8 bitmap is nearest-scaled over the full cell; partial edge cells clip it. Fill ink carries the cell's mean colour; an edge line carries that colour scaled to full brightness, so boundaries stay brighter than the fill. The background is black, and alpha is 1. `AsciiStyle.Filled` draws asciicker's auto-material cells. Removing `Ascii` restores normal camera presentation.

Only `Ascii`, `AsciiStyle` and `AsciiPlugin` are exported. The font data is public domain; see `src/font8x8-NOTICE`. This package does not provide terminal output.

| shallot-ascii | shallot |
| --- | --- |
| 0.1.0 | ^0.10.0 |

See [CONTRIBUTING.md](CONTRIBUTING.md) for checks.
