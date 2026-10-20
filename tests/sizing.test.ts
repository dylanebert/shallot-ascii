import { expect, test } from "bun:test";
import { AsciiStyle } from "../src";
import { cellPixels } from "../src/sizing";

// CPU translation of FindFont and Resize in asciicker 9f494f2 game_web.html.
// Input dimensions are logical window dimensions; backing dimensions are floored.
function oracle(w: number, h: number, ratio: number, style: number, override: number) {
    if (override || style === AsciiStyle.Silhouette)
        return Math.max(1, Math.round(((override || 8) * ratio) / 8)) * 8;
    const fonts = [8, 16, 24, 32, 40];
    const rw = Math.floor(w * ratio) * 0.001;
    const rh = Math.floor(h * ratio) * 0.001;
    const rs = 7.5 * Math.sqrt(rw * rw + rh * rh) * ratio;
    let f = 0;
    for (let i = 1; i < fonts.length; i++)
        if (Math.abs(fonts[f] - rs) > Math.abs(fonts[i] - rs)) f = i;
    while (f >= 1) {
        const cw = Math.floor((w / fonts[f]) * ratio);
        const ch = Math.floor((h / fonts[f]) * ratio);
        if (cw < 45 || ch < 36) f--;
        else break;
    }
    return fonts[f];
}

const targets = [
    [1280, 720, 1],
    [1440, 900, 2],
    [1920, 1080, 1],
    [390, 844, 3],
    [1280, 720, 0], // texture target: no client dimensions, ratio falls back to 1
];
for (const [w, h, deviceRatio] of targets) {
    const ratio = deviceRatio || 1;
    for (const style of [AsciiStyle.Silhouette, AsciiStyle.Filled])
        for (const override of [0, 11])
            test(`reference sizing ${w}x${h} ratio ${deviceRatio} style ${style} override ${override}`, () => {
                expect(
                    cellPixels(
                        w * ratio,
                        h * ratio,
                        deviceRatio ? w : 0,
                        deviceRatio ? h : 0,
                        style,
                        override,
                    ),
                ).toBe(oracle(w, h, ratio, style, override));
            });
}

test("nearest font ties keep the smaller authored scale; overrides have no font-list cap", () => {
    expect(cellPixels(960, 1280, 960, 1280, AsciiStyle.Filled, 0)).toBe(8);
    expect(cellPixels(100, 100, 100, 100, AsciiStyle.Filled, 100)).toBe(104);
    expect(cellPixels(100, 100, 100, 100, AsciiStyle.Silhouette, 1)).toBe(8);
});
