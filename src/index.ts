import { Camera, component, type Plugin, u32, type World } from "@dylanebert/shallot";
import {
    CorePipelinePlugin,
    type EffectPass,
    EffectPasses,
    fullscreenVertex,
    TonemappingSystem,
    Views,
} from "@dylanebert/shallot/rendering";
import {
    beginRenderPass,
    draw,
    endRenderPass,
    precompile,
    setRenderBindGroup,
    setRenderPipeline,
} from "@dylanebert/shallot/runtime";
import tgpu from "typegpu";
import * as d from "typegpu/data";
import { createAutoMat, filledBody } from "./filled";
import { edges, ramp } from "./ramp";
import { cellPixels } from "./sizing";

export const AsciiStyle = {
    Silhouette: 0,
    Filled: 1,
} as const;
/** Opt a camera into bitmap ASCII. cellSize is CSS pixels, rounded to whole physical 8px glyph scales; 0 uses 8 CSS pixels for silhouette, 16 for filled. */
export const Ascii = component(
    "Ascii",
    { cellSize: u32, style: u32 },
    { defaults: () => ({ cellSize: 0, style: AsciiStyle.Silhouette }) },
);

const layout = tgpu
    .bindGroupLayout({
        image: {
            texture: d.texture2d(d.f32),
            sampleType: "unfilterable-float",
            visibility: ["fragment"],
        },
        cellSize: { uniform: d.u32, visibility: ["fragment"] },
        table: { storage: d.arrayOf(d.u32, 32768), access: "readonly", visibility: ["fragment"] },
    })
    .$idx(0);
// Rec. 709 luma below black draws blank. Shallot's 0x191816 clear color tonemaps to 0.102.
const black = 0.12;
// Color-edge gate: the cell's best straight split, among the four drawable tangents, explains
// at least edgeFit of its color variance, its sides differ by edgeStep in RGB and each holds a
// row of pixels. Clutter averages out across any one split; one boundary survives it.
const edgeFit = 0.56;
const edgeStep = 0.1;
// The reduction renders one pixel per cell, so each source pixel contributes only once.
// Alpha carries the cell's edge: 0 none, else 1 + the edges index of its tangent.
const mean = tgpu.fn(
    [d.vec4f, d.texture2d(d.f32), d.u32],
    d.vec4f,
)(`(position: vec4f, image: texture_2d<f32>, cellSize: u32) -> vec4f {
    let size = max(cellSize, 1u);
    let origin = vec2u(position.xy) * size;
    let end = min(origin + vec2u(size), textureDimensions(image));
    // Color sums and counts by position across each split: columns, rows, x + y, x - y.
    var bins: array<vec4f, 46>;
    var color = vec3f(0);
    var square = 0.0;
    for (var y = origin.y; y < end.y; y++) {
        for (var x = origin.x; x < end.x; x++) {
            let c = textureLoad(image, vec2u(x, y), 0).rgb;
            color += c;
            square += dot(c, c);
            let l = (vec2u(x, y) - origin) * 8u / size;
            bins[l.x] += vec4f(c, 1);
            bins[8u + l.y] += vec4f(c, 1);
            bins[16u + l.x + l.y] += vec4f(c, 1);
            bins[31u + l.x + 7u - l.y] += vec4f(c, 1);
        }
    }
    let n = f32((end.x - origin.x) * (end.y - origin.y));
    let m = color / n;
    let total = max(square - n * dot(m, m), 1e-12);
    const bases = array<u32, 4>(0u, 8u, 16u, 31u);
    const lengths = array<u32, 4>(8u, 8u, 15u, 15u);
    const glyphs = array<f32, 4>(1, 3, 2, 4);
    var best = 0.0;
    var contrast = 0.0;
    var edge = 0.0;
    for (var kind = 0u; kind < 4u; kind++) {
        var side = vec4f(0);
        for (var t = 0u; t + 1u < lengths[kind]; t++) {
            side += bins[bases[kind] + t];
            let other = n - side.w;
            if (min(side.w, other) < f32(size)) { continue; }
            let a = side.rgb / side.w;
            let b = (color - side.rgb) / other;
            let fit = (side.w * dot(a - m, a - m) + other * dot(b - m, b - m)) / total;
            if (fit > best) {
                best = fit;
                contrast = length(a - b);
                edge = glyphs[kind];
            }
        }
    }
    if (best < ${edgeFit} || contrast < ${edgeStep} || dot(m, vec3f(0.2126, 0.7152, 0.0722)) < ${black}) {
        edge = 0.0;
    }
    return vec4f(m, edge);
}`);
// A cell edge draws its tangent glyph in its cell's color at full brightness, so boundaries
// stay brighter than fill. Otherwise sqrt-curved luma above black, offset by a 4x4 Bayer
// dither spanning three ramp steps, picks the ramp glyph, inked in the cell's color.
const glyph = tgpu.fn(
    [d.vec4f, d.texture2d(d.f32), d.u32],
    d.vec4f,
)(`(position: vec4f, image: texture_2d<f32>, cellSize: u32) -> vec4f {
    const rows = array<u32, ${ramp.length * 8}>(${ramp
        .flatMap((g) => g.rows)
        .map((n) => `${n}u`)
        .join(",")});
    const edges = array<u32, 32>(${edges
        .flat()
        .map((n) => `${n}u`)
        .join(",")});
    const bayer = array<f32, 16>(0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
    let pixel = vec2u(position.xy);
    let size = max(cellSize, 1u);
    let cellPosition = pixel / size;
    let cell = textureLoad(image, cellPosition, 0);
    let color = cell.rgb;
    let luma = clamp(dot(color, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    let local = (pixel % size) * 8u / size;
    var row = 0u;
    var ink = color;
    if (cell.a > 0.5) {
        ink = color / max(max(color.r, color.g), color.b);
        row = edges[(u32(cell.a) - 1u) * 8u + local.y];
    } else if (luma >= ${black}) {
        let curve = sqrt((luma - ${black}) / ${1 - black});
        let dither = (bayer[cellPosition.y % 4u * 4u + cellPosition.x % 4u] + 0.5) / 16.0 - 0.5;
        let index = u32(clamp(floor(curve * ${ramp.length}.0 + 3.0 * dither), 0.0, ${ramp.length - 1}.0));
        row = rows[index * 8u + local.y];
    }
    return vec4f(select(vec3f(0), ink, ((row >> local.x) & 1u) == 1u), 1);
}`);
const meanFragment = tgpu.fragmentFn({ in: { position: d.builtin.position }, out: d.vec4f })(
    (input) => {
        "use gpu";
        return mean(input.position, layout.$.image, layout.$.cellSize);
    },
);
const glyphFragment = tgpu.fragmentFn({ in: { position: d.builtin.position }, out: d.vec4f })(
    (input) => {
        "use gpu";
        return glyph(input.position, layout.$.image, layout.$.cellSize);
    },
);
const filled = tgpu
    .fn(
        [d.vec4f, d.texture2d(d.f32), d.u32],
        d.vec4f,
    )(filledBody)
    .$uses({ layout });
const filledFragment = tgpu.fragmentFn({ in: { position: d.builtin.position }, out: d.vec4f })(
    (input) => {
        "use gpu";
        return filled(input.position, layout.$.image, layout.$.cellSize);
    },
);
interface CameraState {
    sizing: number[];
    style: number;
    buffer: GPUBuffer;
    bytes: Uint32Array;
    effect: EffectPass;
    means: GPUTexture | null;
    meanSize: number;
}
const stateKey = {
    create: () => ({
        layout: null as GPUBindGroupLayout | null,
        reduction: null as GPURenderPipeline | null,
        table: null as GPUBuffer | null,
        filledPipelines: new Map<GPUTextureFormat, GPURenderPipeline>(),
        pipelines: new Map<GPUTextureFormat, GPURenderPipeline>(),
        cameras: new Map<number, CameraState>(),
        pass: {
            label: "ascii",
            colorAttachments: [{ view: null!, loadOp: "clear", storeOp: "store" }],
        } as GPURenderPassDescriptor,
    }),
};
type AsciiState = ReturnType<typeof stateKey.create>;
const cameras = [Camera, Ascii];

// Keep effect construction outside the update's closure, as in Vignette.
function createCamera(world: World, state: AsciiState): CameraState {
    const buffer = world.gpu.root.unwrap(
        world.gpu.root.createBuffer(d.u32).$usage("uniform").$name("ascii-settings"),
    );
    let groups = new WeakMap<GPUTextureView, GPUBindGroup>();
    let meanView: GPUTextureView;
    let glyphGroup: GPUBindGroup;
    const camera: CameraState = {
        buffer,
        sizing: [-1, -1, -1, -1, -1, -1],
        style: AsciiStyle.Silhouette,
        bytes: new Uint32Array(1),
        effect: null!,
        means: null,
        meanSize: 0,
    };
    camera.effect = (w, _eid, view, input, output) => {
        const size = camera.bytes[0];
        const width = Math.ceil(view.width / size);
        const height = Math.ceil(view.height / size);
        if (
            !camera.means ||
            camera.means.width !== width ||
            camera.means.height !== height ||
            camera.meanSize !== size
        ) {
            camera.means?.destroy();
            // Float32 preserves the reduction for luma thresholds without half-float quantization.
            camera.means = w.gpu.device.createTexture({
                size: [width, height],
                format: "rgba32float",
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            });
            camera.meanSize = size;
            meanView = camera.means.createView();
            glyphGroup = w.gpu.device.createBindGroup({
                layout: state.layout!,
                entries: [
                    { binding: 0, resource: meanView },
                    { binding: 1, resource: { buffer } },
                    { binding: 2, resource: { buffer: state.table! } },
                ],
            });
            groups = new WeakMap();
        }
        let group = groups.get(input);
        if (!group) {
            group = w.gpu.device.createBindGroup({
                layout: state.layout!,
                entries: [
                    { binding: 0, resource: input },
                    { binding: 1, resource: { buffer } },
                    { binding: 2, resource: { buffer: state.table! } },
                ],
            });
            groups.set(input, group);
        }
        const attachment = (state.pass.colorAttachments as GPURenderPassColorAttachment[])[0];
        const format =
            output === view.present ? navigator.gpu.getPreferredCanvasFormat() : "rgba8unorm";
        if (camera.style === AsciiStyle.Filled) {
            attachment.view = output;
            const pass = beginRenderPass(w.frameEncoder()!, state.pass);
            setRenderPipeline(pass, state.filledPipelines.get(format)!);
            setRenderBindGroup(pass, 0, group);
            draw(pass, 3);
            endRenderPass(pass);
            return;
        }
        attachment.view = meanView;
        let pass = beginRenderPass(w.frameEncoder()!, state.pass);
        setRenderPipeline(pass, state.reduction!);
        setRenderBindGroup(pass, 0, group);
        draw(pass, 3);
        endRenderPass(pass);
        attachment.view = output;
        pass = beginRenderPass(w.frameEncoder()!, state.pass);
        setRenderPipeline(pass, state.pipelines.get(format)!);
        setRenderBindGroup(pass, 0, glyphGroup);
        draw(pass, 3);
        endRenderPass(pass);
    };
    return camera;
}
function removeCamera(world: World, eid: number, camera: CameraState) {
    const stack = world.resource(EffectPasses).get(eid)?.after;
    const index = stack?.indexOf(camera.effect) ?? -1;
    if (index >= 0) stack!.splice(index, 1);
    camera.buffer.destroy();
    camera.means?.destroy();
    world.resource(stateKey).cameras.delete(eid);
}
function pruneCamera(this: World, camera: CameraState, eid: number) {
    if (this.has(eid, Camera) && this.has(eid, Ascii) && this.resource(Views).has(eid)) return;
    removeCamera(this, eid, camera);
}
function disposeCamera(this: World, camera: CameraState, eid: number) {
    removeCamera(this, eid, camera);
}
export const AsciiPlugin: Plugin = {
    name: "Ascii",
    gpu: {},
    dependencies: [CorePipelinePlugin],
    components: [Ascii],
    systems: [
        {
            name: "ascii",
            group: "draw",
            before: [TonemappingSystem],
            update(world) {
                const state = world.resource(stateKey);
                const effects = world.resource(EffectPasses);
                const views = world.resource(Views);
                for (const eid of world.query(cameras)) {
                    const view = views.get(eid);
                    if (!view) continue;
                    let camera = state.cameras.get(eid);
                    if (!camera) {
                        camera = createCamera(world, state);
                        state.cameras.set(eid, camera);
                    }
                    let stack = effects.get(eid);
                    if (!stack) {
                        stack = { before: [], after: [] };
                        effects.set(eid, stack);
                    }
                    if (!stack.after.includes(camera.effect)) stack.after.push(camera.effect);
                    camera.style = world.storage(Ascii).style.get(eid);
                    const override = world.storage(Ascii).cellSize.get(eid);
                    const inputs = camera.sizing;
                    if (
                        inputs[0] !== view.width ||
                        inputs[1] !== view.height ||
                        inputs[2] !== view.clientWidth ||
                        inputs[3] !== view.clientHeight ||
                        inputs[4] !== camera.style ||
                        inputs[5] !== override
                    ) {
                        inputs[0] = view.width;
                        inputs[1] = view.height;
                        inputs[2] = view.clientWidth;
                        inputs[3] = view.clientHeight;
                        inputs[4] = camera.style;
                        inputs[5] = override;
                        const size = cellPixels(
                            view.width,
                            view.height,
                            view.clientWidth,
                            view.clientHeight,
                            camera.style,
                            override,
                        );
                        if (camera.bytes[0] !== size) {
                            camera.bytes[0] = size;
                            world.gpu.device.queue.writeBuffer(camera.buffer, 0, camera.bytes);
                        }
                    }
                }
                state.cameras.forEach(pruneCamera, world);
            },
        },
    ],
    async warm(world) {
        const state = world.resource(stateKey);
        const root = world.gpu.root;
        state.layout = root.unwrap(layout);
        state.table = world.gpu.device.createBuffer({
            size: 32768 * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        world.gpu.device.queue.writeBuffer(state.table, 0, createAutoMat());
        state.reduction = root.unwrap(
            root.createRenderPipeline({
                vertex: fullscreenVertex,
                fragment: meanFragment,
                targets: { format: "rgba32float" },
            }),
        );
        precompile(world, "ascii-mean", () => [state.reduction!]);
        for (const format of new Set<GPUTextureFormat>([
            "rgba8unorm",
            navigator.gpu.getPreferredCanvasFormat(),
        ])) {
            const pipeline = root.unwrap(
                root.createRenderPipeline({
                    vertex: fullscreenVertex,
                    fragment: glyphFragment,
                    targets: { format },
                }),
            );
            const filledPipeline = root.unwrap(
                root.createRenderPipeline({
                    vertex: fullscreenVertex,
                    fragment: filledFragment,
                    targets: { format },
                }),
            );
            state.filledPipelines.set(format, filledPipeline);
            precompile(world, `ascii-filled-${format}`, () => [filledPipeline]);
            state.pipelines.set(format, pipeline);
            precompile(world, `ascii-${format}`, () => [pipeline]);
        }
    },
    dispose(world) {
        const state = world.resource(stateKey);
        state.cameras.forEach(disposeCamera, world);
        state.pipelines.clear();
        state.filledPipelines.clear();
        state.table?.destroy();
        state.table = null;
        state.layout = null;
        state.reduction = null;
    },
};
