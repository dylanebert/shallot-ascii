import { expect, setDefaultTimeout, test } from "bun:test";
import { Camera } from "@dylanebert/shallot";
import { attachTexture, captureTexture } from "@dylanebert/shallot/rendering";
import { TIMEOUT } from "@dylanebert/shallot/testing";
import { openGpuApp } from "@dylanebert/shallot/testing/gpu";
import { Ascii } from "@dylanebert/shallot-ascii";
import { Welcome } from "../src/scene";

setDefaultTimeout(TIMEOUT.node);
test("the composed scene draws coloured glyph ink over black in 8-pixel cells", async () => {
    const app = await openGpuApp({ plugins: [Welcome] });
    try {
        const camera = [...app.world.query([Camera])][0];
        attachTexture(app.world, camera, { width: 320, height: 240 });
        app.world.step(1 / 60);
        app.world.step(1 / 60);
        const { rgba, width, height } = await captureTexture(app.world, camera);
        app.world.remove(camera, Ascii);
        app.world.step(0);
        const plain = await captureTexture(app.world, camera);
        const clear = plain.rgba.slice(0, 3);
        let blankGround = 0;
        let glyphs = 0;
        let orange = 0;
        for (let cy = 0; cy < height; cy += 8) {
            for (let cx = 0; cx < width; cx += 8) {
                const colours = new Set<string>();
                let black = 0;
                let clearPixels = 0;
                for (let y = cy; y < cy + 8; y++) {
                    for (let x = cx; x < cx + 8; x++) {
                        const i = (y * width + x) * 4;
                        const [r, g, b] = rgba.slice(i, i + 3);
                        if (clear.every((value, c) => Math.abs(plain.rgba[i + c] - value) <= 2))
                            clearPixels++;
                        if (r + g + b === 0) black++;
                        else colours.add(`${r},${g},${b}`);
                        if (r > g * 1.2 && g > b * 1.2) orange++;
                    }
                }
                if (clearPixels === 64) {
                    expect(black).toBe(64);
                    blankGround++;
                }
                if (black > 0 && black < 64 && colours.size === 1) glyphs++;
            }
        }
        expect(blankGround).toBeGreaterThan(100);
        expect(glyphs).toBeGreaterThan(100);
        expect(orange).toBeGreaterThan(100);
    } finally {
        app.dispose();
    }
});
