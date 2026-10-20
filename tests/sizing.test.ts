import { expect, test } from "bun:test";
import { AsciiStyle } from "../src";
import { cellPixels } from "../src/sizing";

// Logical viewport, device ratio, silhouette default and 11 CSS-pixel override.
const targets = [
    [1280, 720, 1, 8, 8],
    [1440, 900, 2, 16, 24],
    [1920, 1080, 1, 8, 8],
    [390, 844, 3, 24, 32],
    [1280, 720, 0, 8, 8], // texture target: ratio falls back to 1
];
for (const [w, h, deviceRatio, defaultSize, explicitSize] of targets) {
    const ratio = deviceRatio || 1;
    for (const [override, expected] of [
        [0, defaultSize],
        [11, explicitSize],
    ]) {
        test(`style sizes at ${w}x${h} ratio ${deviceRatio} override ${override}`, () => {
            const sizes = [AsciiStyle.Silhouette, AsciiStyle.Filled].map((style) =>
                cellPixels(
                    w * ratio,
                    h * ratio,
                    deviceRatio ? w : 0,
                    deviceRatio ? h : 0,
                    style,
                    override,
                ),
            );
            expect(sizes).toEqual([expected, override ? expected : expected * 2]);
        });
    }
}

test("overrides round to whole glyph scales, with a one-glyph minimum and no cap", () => {
    for (const style of [AsciiStyle.Silhouette, AsciiStyle.Filled]) {
        expect(cellPixels(100, 100, 100, 100, style, 100)).toBe(104);
        expect(cellPixels(100, 100, 100, 100, style, 1)).toBe(8);
    }
});
