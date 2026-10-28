import { expect, setDefaultTimeout, test } from "bun:test";
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

setDefaultTimeout(TIMEOUT.gpu);
const side = 128,
    size = 8,
    cells = side / size;
// font8x8_box.h tangent glyphs, keyed by the boundary's angle on screen.
const tangents: Record<number, number[]> = {
    0: [0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00],
    45: [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
    90: [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08],
    135: [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
};

// A half-plane of one color over a clear color, its edge through the frame at `degrees`,
// offset off the cell grid.
async function boundary(degrees: number) {
    let camera = 0;
    const app = await openGpuApp({
        defaults: false,
        plugins: [
            StandardRenderingPlugin,
            MeshRenderPlugin,
            AsciiPlugin,
            {
                name: "Boundary",
                dependencies: [StandardRenderingPlugin, MeshRenderPlugin],
                initialize(world) {
                    camera = world.create();
                    world.add(camera, Transform, { translation: [0, 0, 4] });
                    world.add(camera, Camera, { clearColor: 0x2a5c9a });
                    world.add(camera, StandardRenderer);
                    world.add(camera, Tonemapping, { method: TonemappingMethod.None });
                    world.add(camera, Ascii, { cellSize: size });
                    attachTexture(world, camera, { width: side, height: side });
                    const mesh = world.resource(Meshes).add({
                        name: "HalfPlane",
                        vertices: new Float32Array([
                            -40, 0, 0, 0, 0, 0, 0, 1, 40, 0, 0, 1, 0, 0, 0, 1, 0, -40, 0, 0.5, 1, 0,
                            0, 1,
                        ]),
                        indices: new Uint32Array([0, 2, 1]),
                    });
                    const material = world
                        .resource(Materials)
                        .add(StandardMaterial({ baseColor: [0.9, 0.55, 0.1, 1], unlit: true }));
                    const half = (degrees * Math.PI) / 360;
                    const plane = world.create();
                    world.add(plane, Transform, {
                        translation: [0.07, 0.11, 0],
                        rotation: [0, 0, Math.sin(half), Math.cos(half)],
                    });
                    world.add(plane, MeshInstance, { mesh });
                    world.add(plane, MeshMaterial, material);
                },
            },
        ],
    });
    try {
        app.world.step(0);
        app.world.step(0);
        const ascii = await captureTexture(app.world, camera);
        app.world.remove(camera, Ascii);
        app.world.step(0);
        const plain = await captureTexture(app.world, camera);
        return { ascii: ascii.rgba, plain: plain.rgba };
    } finally {
        app.dispose();
    }
}

function glyphAt(rgba: Uint8ClampedArray, cx: number, cy: number) {
    const rows: number[] = [];
    for (let y = 0; y < size; y++) {
        let row = 0;
        for (let x = 0; x < size; x++) {
            const i = ((cy * size + y) * side + cx * size + x) * 4;
            if (rgba[i] + rgba[i + 1] + rgba[i + 2] > 0) row |= 1 << x;
        }
        rows.push(row);
    }
    return rows;
}

for (const degrees of [0, 45, 90, 135])
    test(`a ${degrees}° color boundary draws one continuous run of its tangent glyph`, async () => {
        const { ascii, plain } = await boundary(degrees);
        const clear = plain.slice(0, 3).join();
        const tangent = tangents[degrees].join();
        const run = new Set<number>();
        const crossed: number[] = [];
        for (let cy = 0; cy < cells; cy++)
            for (let cx = 0; cx < cells; cx++) {
                let face = 0;
                for (let y = 0; y < size; y++)
                    for (let x = 0; x < size; x++) {
                        const i = ((cy * size + y) * side + cx * size + x) * 4;
                        if (plain.slice(i, i + 3).join() !== clear) face++;
                    }
                // The boundary crosses the cell with at least a row of pixels on each side.
                if (face >= size && face <= size * size - size) crossed.push(cy * cells + cx);
                const drawn = glyphAt(ascii, cx, cy).join();
                if (drawn === tangent) run.add(cy * cells + cx);
                else
                    expect(Object.values(tangents).map((rows) => rows.join())).not.toContain(drawn);
            }
        expect(crossed.length).toBeGreaterThanOrEqual(cells - 2);
        for (const cell of crossed) expect(run.has(cell)).toBe(true);
        // Every tangent cell touches the boundary, and they form one 8-connected run.
        const near = (a: number, b: number) =>
            Math.abs((a % cells) - (b % cells)) <= 1 &&
            Math.abs(Math.floor(a / cells) - Math.floor(b / cells)) <= 1;
        for (const cell of run) expect(crossed.some((c) => near(c, cell))).toBe(true);
        const seen = new Set<number>();
        for (const queue = [...run].slice(0, 1); queue.length; ) {
            const cell = queue.pop()!;
            if (seen.has(cell)) continue;
            seen.add(cell);
            for (const next of run) if (!seen.has(next) && near(cell, next)) queue.push(next);
        }
        expect(seen.size).toBe(run.size);
    });
