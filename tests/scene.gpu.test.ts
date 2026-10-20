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
import { Ascii, AsciiPlugin, AsciiStyle } from "../src";
import { font } from "../src/font";
import { filledReference } from "./filled-oracle";

setDefaultTimeout(TIMEOUT.gpu);
const width = 71,
    height = 59,
    size = 9;
// font8x8_box.h U+2502, U+2571, U+2500, U+2572: vertical, rising, horizontal, falling.
const box = [
    [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08],
    [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
    [0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00],
    [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
];
// Straight splits of a cell on its 8x8 scaled coordinates, tried in this order: columns,
// rows, x + y, x - y; each with the box line drawn along it.
type Project = (x: number, y: number) => number;
const projections: Project[] = [(x) => x, (_, y) => y, (x, y) => x + y, (x, y) => x - y + 7];
const splits = projections.map((project, i) => ({
    project,
    length: i < 2 ? 8 : 15,
    glyph: [0, 2, 1, 3][i],
}));
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// Independent selector, edge gate and bitmap addressing, using only the upstream font data.
// Cells whose decision lies within float rounding of a threshold are returned as ambiguous.
function reference(input: Uint8ClampedArray) {
    const w = width,
        h = height,
        s = size;
    const glyphs = font
        .map((rows, i) => ({
            rows,
            i,
            ink: rows.reduce(
                (sum, row) => sum + [...row.toString(2)].filter((b) => b === "1").length,
                0,
            ),
        }))
        .filter((glyph) => " .:+*XZ0".includes(String.fromCharCode(glyph.i + 32)))
        .sort((a, b) => a.ink - b.ink || a.i - b.i);
    const out = new Uint8Array(input.length);
    const ambiguous: [number, number][] = [];
    const edgesDrawn: number[] = [];
    const near = (v: number) => Math.abs(v) < 1e-4;
    for (let cy = 0; cy < h; cy += s)
        for (let cx = 0; cx < w; cx += s) {
            const pixels: { x: number; y: number; c: number[] }[] = [];
            for (let y = cy; y < Math.min(cy + s, h); y++)
                for (let x = cx; x < Math.min(cx + s, w); x++)
                    pixels.push({
                        x: Math.floor(((x - cx) * 8) / s),
                        y: Math.floor(((y - cy) * 8) / s),
                        c: [0, 1, 2].map((c) => input[(y * w + x) * 4 + c] / 255),
                    });
            const average = (set: typeof pixels) =>
                [0, 1, 2].map((c) => set.reduce((sum, p) => sum + p.c[c], 0) / set.length);
            const distance2 = (a: number[], b: number[]) =>
                a.reduce((sum, v, c) => sum + (v - b[c]) ** 2, 0);
            const mean = average(pixels);
            const total = pixels.reduce((sum, p) => sum + distance2(p.c, mean), 0);
            const luma = mean[0] * 0.2126 + mean[1] * 0.7152 + mean[2] * 0.0722;
            let best = 0,
                second = 0,
                contrast = 0,
                edge = -1;
            for (const { project, length, glyph } of splits)
                for (let t = 1; t < length; t++) {
                    const a = pixels.filter((p) => project(p.x, p.y) < t);
                    const b = pixels.filter((p) => project(p.x, p.y) >= t);
                    if (Math.min(a.length, b.length) < s) continue;
                    const ma = average(a),
                        mb = average(b);
                    const fit =
                        (a.length * distance2(ma, mean) + b.length * distance2(mb, mean)) /
                        Math.max(total, 1e-12);
                    if (fit > best) {
                        second = best;
                        best = fit;
                        contrast = Math.sqrt(distance2(ma, mb));
                        edge = glyph;
                    } else second = Math.max(second, fit);
                }
            const isEdge = best >= 0.56 && contrast >= 0.1 && luma >= 0.12;
            const curve = Math.sqrt(Math.max(0, luma - 0.12) / 0.88);
            const dither = (bayer[((cy / s) % 4) * 4 + ((cx / s) % 4)] + 0.5) / 16 - 0.5;
            const step = curve * glyphs.length + 3 * dither;
            if (
                near(luma - 0.12) ||
                (luma >= 0.12 && (near(best - 0.56) || near(contrast - 0.1))) ||
                (isEdge && near(best - second)) ||
                (luma >= 0.12 && !isEdge && near(step - Math.round(step)))
            )
                ambiguous.push([cx / s, cy / s]);
            let rows: number[] = Array(8).fill(0);
            let scale = 1;
            if (isEdge) {
                scale = 1 / Math.max(...mean);
                edgesDrawn.push(edge);
                rows = box[edge];
            } else if (luma >= 0.12)
                rows = glyphs[Math.min(Math.max(Math.floor(step), 0), glyphs.length - 1)].rows;
            for (let y = cy; y < Math.min(cy + s, h); y++)
                for (let x = cx; x < Math.min(cx + s, w); x++) {
                    const ink =
                        (rows[Math.floor(((y - cy) * 8) / s)] >> Math.floor(((x - cx) * 8) / s)) &
                        1;
                    for (let c = 0; c < 3; c++)
                        out[(y * w + x) * 4 + c] = ink ? Math.round(mean[c] * scale * 255) : 0;
                    out[(y * w + x) * 4 + 3] = 255;
                }
        }
    return { out, ambiguous, edgesDrawn };
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
test("camera ASCII matches cell means, edge gate, dithered luma ramp and upright bitmaps including partial edges", async () => {
    const { app, cameras } = await fixture(true);
    try {
        app.world.step(0);
        app.world.step(0);
        const [ascii, plain, other] = await Promise.all(
            cameras.map((eid) => captureTexture(app.world, eid)),
        );
        expect(new Set(plain.rgba).size).toBeGreaterThan(8);
        const { out: expected, ambiguous, edgesDrawn } = reference(plain.rgba);
        expect(ambiguous).toEqual([]);
        expect(edgesDrawn.length).toBeGreaterThan(0);
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

test("Filled matches the independent asciicker table and resolve, cell for cell", async () => {
    const { app, cameras } = await fixture(true);
    try {
        app.world.storage(Ascii).style.set(cameras[0], AsciiStyle.Filled);
        app.world.step(0);
        app.world.step(0);
        const ascii = await captureTexture(app.world, cameras[0]);
        const plain = await captureTexture(app.world, cameras[1]);
        const { out, cells } = filledReference(plain.rgba, width, height, size);
        expect(new Set(cells.map((c) => c.gl)).has(0xdf)).toBe(true);
        expect(new Set(cells.map((c) => c.gl)).has(0xde)).toBe(true);
        expect(cells.some((c) => c.gl < 128)).toBe(true);
        expect(ascii.rgba).toEqual(new Uint8ClampedArray(out));
        app.world.storage(Ascii).style.set(cameras[0], AsciiStyle.Silhouette);
        app.world.step(0);
        const silhouette = await captureTexture(app.world, cameras[0]);
        const { out: expected } = reference(plain.rgba);
        expect(silhouette.rgba.every((v, i) => Math.abs(v - expected[i]) <= 1)).toBe(true);
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
