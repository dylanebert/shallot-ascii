import { expect, setDefaultTimeout, spyOn, test } from "bun:test";
import {
    Camera,
    Materials,
    Meshes,
    MeshInstance,
    MeshMaterial,
    StandardMaterial,
    StandardRenderer,
    Tonemapping,
    TonemappingMethod,
    Transform,
} from "@dylanebert/shallot";
import { attachTexture, captureTexture } from "@dylanebert/shallot/rendering";
import { MeshRenderPlugin, StandardRenderingPlugin } from "@dylanebert/shallot/standard/rendering";
import { TIMEOUT } from "@dylanebert/shallot/testing";
import { openGpuApp } from "@dylanebert/shallot/testing/gpu";
import { Ascii, AsciiPlugin } from "../src";
import { font } from "../src/font";

setDefaultTimeout(TIMEOUT.gpu);
const width = 71,
    height = 59,
    size = 9;
// Independent selector and bitmap addressing, using only the upstream font data.
function reference(input: Uint8ClampedArray) {
    const glyphs = font
        .map((rows, i) => ({
            rows,
            i,
            ink: rows.reduce(
                (sum, row) => sum + [...row.toString(2)].filter((b) => b === "1").length,
                0,
            ),
        }))
        .filter((glyph) => " .:-=+*#%@".includes(String.fromCharCode(glyph.i + 32)))
        .sort((a, b) => a.ink - b.ink || a.i - b.i);
    const out = new Uint8Array(input.length);
    for (let cy = 0; cy < height; cy += size)
        for (let cx = 0; cx < width; cx += size) {
            const endX = Math.min(cx + size, width),
                endY = Math.min(cy + size, height);
            const mean = [0, 0, 0];
            for (let y = cy; y < endY; y++)
                for (let x = cx; x < endX; x++)
                    for (let c = 0; c < 3; c++) mean[c] += input[(y * width + x) * 4 + c] / 255;
            for (let c = 0; c < 3; c++) mean[c] /= (endX - cx) * (endY - cy);
            const luma = mean[0] * 0.2126 + mean[1] * 0.7152 + mean[2] * 0.0722;
            const rows = glyphs[Math.min(Math.floor(luma * glyphs.length), glyphs.length - 1)].rows;
            for (let y = cy; y < endY; y++)
                for (let x = cx; x < endX; x++) {
                    const ink =
                        (rows[Math.floor(((y - cy) * 8) / size)] >>
                            Math.floor(((x - cx) * 8) / size)) &
                        1;
                    for (let c = 0; c < 3; c++)
                        out[(y * width + x) * 4 + c] = Math.round(mean[c] * 255) * ink;
                    out[(y * width + x) * 4 + 3] = 255;
                }
        }
    return out;
}
async function fixture(withAscii: boolean) {
    const cameras: number[] = [];
    const app = await openGpuApp({
        defaults: false,
        plugins: [
            StandardRenderingPlugin,
            MeshRenderPlugin,
            ...(withAscii ? [AsciiPlugin] : []),
            {
                name: "Fixture",
                dependencies: [StandardRenderingPlugin, MeshRenderPlugin],
                initialize(world) {
                    for (let i = 0; i < 3; i++) {
                        const eid = world.create();
                        cameras.push(eid);
                        world.add(eid, Transform, { translation: [0, 0, 4] });
                        world.add(eid, Camera);
                        world.add(eid, StandardRenderer);
                        world.add(eid, Tonemapping, { method: TonemappingMethod.None });
                        if (i === 0 && withAscii) world.add(eid, Ascii, { cellSize: size });
                        attachTexture(world, eid, { width, height });
                    }
                    const mesh = world.resource(Meshes).add({
                        name: "Triangle",
                        vertices: new Float32Array([
                            -3, -2, 0, 0, 0, 0, 1, 0, 3, -2, 0, 1, 0, 0, 1, 0, 0, 3, 0, 0.5, 1, 0,
                            1, 0,
                        ]),
                        indices: new Uint32Array([0, 1, 2]),
                    });
                    for (const [x, y, color] of [
                        [-0.8, 0.2, [0.8, 0.1, 0.04, 1]],
                        [0.9, -0.7, [0.1, 0.9, 0.3, 1]],
                        [0, 1, [0.7, 0.7, 1, 1]],
                    ] as const) {
                        const material = world
                            .resource(Materials)
                            .add(StandardMaterial({ baseColor: [...color], unlit: true }));
                        const eid = world.create();
                        world.add(eid, Transform, {
                            translation: [x, y, 0],
                            scale: [0.5, 0.5, 0.5],
                        });
                        world.add(eid, MeshInstance, { mesh });
                        world.add(eid, MeshMaterial, material);
                    }
                },
            },
        ],
    });
    return { app, cameras };
}
test("camera ASCII matches cell means, luma ramp and upright bitmaps including partial edges", async () => {
    const { app, cameras } = await fixture(true);
    try {
        app.world.step(0);
        app.world.step(0);
        const [ascii, plain, other] = await Promise.all(
            cameras.map((eid) => captureTexture(app.world, eid)),
        );
        expect(new Set(plain.rgba).size).toBeGreaterThan(8);
        const expected = reference(plain.rgba);
        let maxError = 0;
        for (let i = 0; i < expected.length; i++)
            maxError = Math.max(maxError, Math.abs(ascii.rgba[i] - expected[i]));
        expect(maxError).toBeLessThanOrEqual(1);
        expect(ascii.rgba).not.toEqual(plain.rgba);
        expect(other.rgba).toEqual(plain.rgba);
        const baseline = await fixture(false);
        try {
            baseline.app.world.step(0);
            baseline.app.world.step(0);
            expect((await captureTexture(baseline.app.world, baseline.cameras[1])).rgba).toEqual(
                plain.rgba,
            );
        } finally {
            baseline.app.dispose();
        }
        app.world.remove(cameras[0], Ascii);
        app.world.step(0);
        expect((await captureTexture(app.world, cameras[0])).rgba).toEqual(plain.rgba);
        app.world.add(cameras[0], Ascii, { cellSize: size });
        app.world.step(0);
        expect((await captureTexture(app.world, cameras[0])).rgba).toEqual(ascii.rgba);
    } finally {
        app.dispose();
    }
});

test("ASCII settings upload only when cellSize changes and draws reuse their descriptor", async () => {
    const { app, cameras } = await fixture(true);
    const writes = spyOn(
        Object.getPrototypeOf(app.world.gpu.device.queue) as GPUQueue,
        "writeBuffer",
    );
    const encoder = app.world.gpu.device.createCommandEncoder();
    const passes = spyOn(Object.getPrototypeOf(encoder) as GPUCommandEncoder, "beginRenderPass");
    const settingsWrites = () =>
        writes.mock.calls.filter((call) => call[0].label === "ascii-settings");
    try {
        app.world.step(0);
        expect(settingsWrites()).toHaveLength(1);
        const buffer = settingsWrites()[0][0];
        writes.mockClear();
        for (let i = 0; i < 4; i++) app.world.step(0);
        expect(settingsWrites()).toHaveLength(0);
        app.world.storage(Ascii).cellSize.set(cameras[0], size + 1);
        app.world.step(0);
        expect(settingsWrites()).toHaveLength(1);
        expect(settingsWrites()[0][0]).toBe(buffer);
        expect(Array.from(settingsWrites()[0][2] as Uint32Array)).toEqual([size + 1]);
        writes.mockClear();
        for (let i = 0; i < 4; i++) app.world.step(0);
        expect(settingsWrites()).toHaveLength(0);
        const descriptors = passes.mock.calls
            .map((call) => call[0])
            .filter((descriptor) => descriptor.label === "ascii");
        expect(descriptors.length).toBeGreaterThanOrEqual(18);
        expect(new Set(descriptors).size).toBe(1);
    } finally {
        passes.mockRestore();
        writes.mockRestore();
        app.dispose();
    }
});
