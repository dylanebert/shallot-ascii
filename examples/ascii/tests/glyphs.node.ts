import { expect, setDefaultTimeout, test } from "bun:test";
import { Camera } from "@dylanebert/shallot";
import { attachTexture, captureTexture } from "@dylanebert/shallot/rendering";
import { TIMEOUT } from "@dylanebert/shallot/testing";
import { openGpuApp } from "@dylanebert/shallot/testing/gpu";
import { Ascii, AsciiStyle } from "@dylanebert/shallot-ascii";
import { Welcome } from "../src/scene";

setDefaultTimeout(TIMEOUT.node);
for (const style of [AsciiStyle.Silhouette, AsciiStyle.Filled]) {
    test(`the composed scene holds style ${style}'s colored cells at its default size`, async () => {
        const cell = style === AsciiStyle.Filled ? 16 : 8;
        const app = await openGpuApp({ plugins: [Welcome] });
        try {
            const camera = [...app.world.query([Camera])][0];
            attachTexture(app.world, camera, { width: 320, height: 240 });
            app.world.storage(Ascii).style.set(camera, style);
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
            let cubeColors = 0;
            let nonCubeColors = 0;
            let twoColorCells = 0;
            for (let cy = 0; cy < height; cy += cell) {
                for (let cx = 0; cx < width; cx += cell) {
                    const colors = new Set<string>();
                    let black = 0;
                    let clearPixels = 0;
                    for (let y = cy; y < cy + cell; y++) {
                        for (let x = cx; x < cx + cell; x++) {
                            const i = (y * width + x) * 4;
                            const [r, g, b] = rgba.slice(i, i + 3);
                            if (clear.every((value, c) => Math.abs(plain.rgba[i + c] - value) <= 2))
                                clearPixels++;
                            if (r + g + b === 0) black++;
                            else {
                                colors.add(`${r},${g},${b}`);
                                if ([r, g, b].every((v) => v % 51 === 0)) cubeColors++;
                                else nonCubeColors++;
                            }
                            if (r > g * 1.2 && g > b * 1.2) orange++;
                        }
                    }
                    if (colors.size === 2) twoColorCells++;
                    if (clearPixels === cell * cell && style === AsciiStyle.Silhouette) {
                        expect(black).toBe(cell * cell);
                        blankGround++;
                    }
                    if (black > 0 && black < cell * cell && colors.size === 1) glyphs++;
                }
            }
            if (style === AsciiStyle.Silhouette) {
                expect(blankGround).toBeGreaterThan(100);
                expect(glyphs).toBeGreaterThan(100);
                expect(nonCubeColors).toBeGreaterThan(100);
            } else {
                expect(cubeColors).toBeGreaterThan(1000);
                expect(nonCubeColors).toBe(0);
                expect(twoColorCells).toBeGreaterThan(((width / cell) * (height / cell)) / 12);
            }
            expect(orange).toBeGreaterThan(100);
        } finally {
            app.dispose();
        }
    });
}
