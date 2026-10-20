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

export enum AsciiStyle {
    Silhouette,
    Filled,
}
/** Opt a camera into bitmap ASCII. cellSize is in physical target pixels, minimum 1. */
export const Ascii = component(
    "Ascii",
    { cellSize: u32, style: u32 },
    { defaults: () => ({ cellSize: 8, style: AsciiStyle.Silhouette }) },
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
// Rec. 709 luma below black draws blank; the clear colour of examples/ascii sits under it.
const black = 0.1;
// Colour-edge gate: Sobel/4 structure-tensor energy per cell row, about a 0.06 grey step.
const edgeGate = 0.02;
// The reduction renders one pixel per cell, so each source pixel contributes only once.
// Alpha carries the cell's edge: 0 none, else 1 + the quantized gradient angle.
const mean = tgpu.fn(
    [d.vec4f, d.texture2d(d.f32), d.u32],
    d.vec4f,
)(`(position: vec4f, image: texture_2d<f32>, cellSize: u32) -> vec4f {
    let size = max(cellSize, 1u);
    let dims = textureDimensions(image);
    let last = vec2i(dims) - 1;
    let origin = vec2u(position.xy) * size;
    let end = min(origin + vec2u(size), dims);
    var color = vec3f(0);
    var j = vec3f(0);
    for (var y = origin.y; y < end.y; y++) {
        for (var x = origin.x; x < end.x; x++) {
            let p = vec2i(i32(x), i32(y));
            var n: array<vec3f, 9>;
            for (var k = 0; k < 9; k++) {
                n[k] = textureLoad(image, clamp(p + vec2i(k % 3 - 1, k / 3 - 1), vec2i(0), last), 0).rgb;
            }
            color += n[4];
            let gx = (n[2] + 2.0 * n[5] + n[8] - n[0] - 2.0 * n[3] - n[6]) * 0.25;
            let gy = (n[6] + 2.0 * n[7] + n[8] - n[0] - 2.0 * n[1] - n[2]) * 0.25;
            j += vec3f(dot(gx, gx), dot(gy, gy), dot(gx, gy));
        }
    }
    color /= f32((end.x-origin.x)*(end.y-origin.y));
    var edge = 0.0;
    if ((j.x + j.y) / f32(size) > ${edgeGate} && dot(color, vec3f(0.2126, 0.7152, 0.0722)) >= ${black}) {
        let angle = 0.5 * atan2(2.0 * j.z, j.x - j.y);
        edge = f32((i32(round(angle / 0.7853981633974483)) + 4) % 4 + 1);
    }
    return vec4f(color, edge);
}`);
// A cell edge draws its tangent glyph. Otherwise sqrt-curved luma above black, offset by a
// 4x4 Bayer dither spanning three ramp steps, picks the ramp glyph. Ink carries the cell colour
// lifted to the square root of its brightest channel.
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
    if (cell.a > 0.5) {
        row = edges[(u32(cell.a) - 1u) * 8u + local.y];
    } else if (luma >= ${black}) {
        let curve = sqrt((luma - ${black}) / ${1 - black});
        let dither = (bayer[cellPosition.y % 4u * 4u + cellPosition.x % 4u] + 0.5) / 16.0 - 0.5;
        let index = u32(clamp(floor(curve * ${ramp.length}.0 + 3.0 * dither), 0.0, ${ramp.length - 1}.0));
        row = rows[index * 8u + local.y];
    }
    let ink = (row >> local.x) & 1u;
    let peak = max(max(color.r, color.g), color.b);
    return vec4f(select(vec3f(0), color / sqrt(peak), ink == 1u && peak > 0.0), 1);
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
                    if (!views.has(eid)) continue;
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
                    const size = Math.max(1, world.storage(Ascii).cellSize.get(eid));
                    if (camera.bytes[0] !== size) {
                        camera.bytes[0] = size;
                        world.gpu.device.queue.writeBuffer(camera.buffer, 0, camera.bytes);
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
