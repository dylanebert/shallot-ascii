import { font } from "./font";

// The ASCII CITY capture's sparse marks and dense fill glyphs, ordered by measured ink.
export const ramp = font
    .map((rows, i) => ({
        char: String.fromCharCode(i + 32),
        rows,
        ink: rows.reduce((n, row) => n + row.toString(2).replaceAll("0", "").length, 0),
    }))
    .filter((glyph) => " .:+*XZ0".includes(glyph.char))
    .sort((a, b) => a.ink - b.ink || a.char.charCodeAt(0) - b.char.charCodeAt(0));

// font8x8_box.h U+2502, U+2571, U+2500, U+2572, indexed by quantized gradient angle
// 0°, 45°, 90°, 135° (y down): the tangent glyph of each colour edge.
export const edges = [
    [8, 8, 8, 8, 8, 8, 8, 8],
    [128, 64, 32, 16, 8, 4, 2, 1],
    [0, 0, 0, 0, 255, 0, 0, 0],
    [1, 2, 4, 8, 16, 32, 64, 128],
];
