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
import { ramp } from "./ramp";

/** Opt a camera into bitmap ASCII. cellSize is in physical target pixels, minimum 1. */
export const Ascii = component("Ascii", { cellSize: u32 }, { defaults: () => ({ cellSize: 8 }) });

const layout = tgpu
    .bindGroupLayout({
        image: {
            texture: d.texture2d(d.f32),
            sampleType: "unfilterable-float",
            visibility: ["fragment"],
        },
        cellSize: { uniform: d.u32, visibility: ["fragment"] },
    })
    .$idx(0);
// The reduction renders one pixel per cell, so each source pixel contributes only once.
const mean = tgpu.fn(
    [d.vec4f, d.texture2d(d.f32), d.u32],
    d.vec4f,
)(`(position: vec4f, image: texture_2d<f32>, cellSize: u32) -> vec4f {
    let size = max(cellSize, 1u);
    let origin = vec2u(position.xy) * size;
    let end = min(origin + vec2u(size), textureDimensions(image));
    var color = vec3f(0);
    for (var y = origin.y; y < end.y; y++) {
        for (var x = origin.x; x < end.x; x++) {
            color += textureLoad(image, vec2u(x,y), 0).rgb;
        }
    }
    color /= f32((end.x-origin.x)*(end.y-origin.y));
    return vec4f(color, 1);
}`);
const glyph = tgpu.fn(
    [d.vec4f, d.texture2d(d.f32), d.u32],
    d.vec4f,
)(`(position: vec4f, image: texture_2d<f32>, cellSize: u32) -> vec4f {
    const rows = array<u32, ${ramp.length * 8}>(${ramp
        .flatMap((g) => g.rows)
        .map((n) => `${n}u`)
        .join(",")});
    let pixel = vec2u(position.xy);
    let size = max(cellSize, 1u);
    let color = textureLoad(image, pixel / size, 0).rgb;
    let luma = clamp(dot(color, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    let index = min(u32(luma * ${ramp.length}.0), ${ramp.length - 1}u);
    let local = (pixel % size) * 8u / size;
    let ink = (rows[index*8u+local.y] >> local.x) & 1u;
    return vec4f(color * f32(ink), 1);
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
interface CameraState {
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
                ],
            });
            groups.set(input, group);
        }
        const attachment = (state.pass.colorAttachments as GPURenderPassColorAttachment[])[0];
        attachment.view = meanView;
        let pass = beginRenderPass(w.frameEncoder()!, state.pass);
        setRenderPipeline(pass, state.reduction!);
        setRenderBindGroup(pass, 0, group);
        draw(pass, 3);
        endRenderPass(pass);
        attachment.view = output;
        pass = beginRenderPass(w.frameEncoder()!, state.pass);
        const format =
            output === view.present ? navigator.gpu.getPreferredCanvasFormat() : "rgba8unorm";
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
            state.pipelines.set(format, pipeline);
            precompile(world, `ascii-${format}`, () => [pipeline]);
        }
    },
    dispose(world) {
        const state = world.resource(stateKey);
        state.cameras.forEach(disposeCamera, world);
        state.pipelines.clear();
        state.layout = null;
        state.reduction = null;
    },
};
