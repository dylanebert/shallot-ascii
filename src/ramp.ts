import { font } from "./font";

export const ramp = font
    .map((rows, i) => ({
        char: String.fromCharCode(i + 32),
        rows,
        ink: rows.reduce((n, row) => n + row.toString(2).replaceAll("0", "").length, 0),
    }))
    .filter((glyph) => " .:-=+*#%@".includes(glyph.char))
    .sort((a, b) => a.ink - b.ink || a.char.charCodeAt(0) - b.char.charCodeAt(0));
