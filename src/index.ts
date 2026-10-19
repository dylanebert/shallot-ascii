import { Camera, component, type Plugin, u32 } from "@dylanebert/shallot";
import {
    CorePipelinePlugin,
    type EffectPass,
    EffectPasses,
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
import { ramp } from "./ramp";

/** Opt a camera into bitmap ASCII. cellSize is in physical target pixels, minimum 1. */
export const Ascii = component("Ascii", { cellSize: u32 }, { defaults: () => ({ cellSize: 8 }) });

const shader = `
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<uniform> cellSize: u32;
const rows = array<u32, ${ramp.length * 8}>(${ramp
    .flatMap((g) => g.rows)
    .map((n) => `${n}u`)
    .join(",")});
@vertex fn vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let p = array<vec2f, 3>(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3));
    return vec4f(p[i], 0, 1);
}
@fragment fn fragment(@builtin(position) position: vec4f) -> @location(0) vec4f {
    let pixel = vec2u(position.xy);
    let size = max(cellSize, 1u);
    let origin = pixel / size * size;
    let end = min(origin + vec2u(size), textureDimensions(image));
    var color = vec3f(0);
    for (var y = origin.y; y < end.y; y++) {
        for (var x = origin.x; x < end.x; x++) {
            color += textureLoad(image, vec2u(x,y), 0).rgb;
        }
    }
    color /= f32((end.x-origin.x)*(end.y-origin.y));
    let luma = clamp(dot(color, vec3f(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    let glyph = min(u32(luma * ${ramp.length}.0), ${ramp.length - 1}u);
    let local = (pixel-origin) * 8u / size;
    let ink = (rows[glyph*8u+local.y] >> local.x) & 1u;
    return vec4f(color * f32(ink), 1);
}`;
const stateKey = {
    create: () => ({
        layout: null as GPUBindGroupLayout | null,
        pipelines: new Map<GPUTextureFormat, GPURenderPipeline>(),
        cameras: new Map<number, { buffer: GPUBuffer; effect: EffectPass }>(),
    }),
};
const cameras = [Camera, Ascii];

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
                        const buffer = world.gpu.device.createBuffer({
                            size: 16,
                            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                        });
                        const groups = new WeakMap<GPUTextureView, GPUBindGroup>();
                        const effect: EffectPass = (w, _eid, view, input, output) => {
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
                            const format =
                                output === view.present
                                    ? navigator.gpu.getPreferredCanvasFormat()
                                    : "rgba8unorm";
                            const pass = beginRenderPass(w.frameEncoder()!, {
                                colorAttachments: [
                                    { view: output, loadOp: "clear", storeOp: "store" },
                                ],
                            });
                            setRenderPipeline(pass, state.pipelines.get(format)!);
                            setRenderBindGroup(pass, 0, group);
                            draw(pass, 3);
                            endRenderPass(pass);
                        };
                        camera = { buffer, effect };
                        state.cameras.set(eid, camera);
                    }
                    let stack = effects.get(eid);
                    if (!stack) {
                        stack = { before: [], after: [] };
                        effects.set(eid, stack);
                    }
                    if (!stack.after.includes(camera.effect)) stack.after.push(camera.effect);
                    world.gpu.device.queue.writeBuffer(
                        camera.buffer,
                        0,
                        new Uint32Array([Math.max(1, world.storage(Ascii).cellSize.get(eid))]),
                    );
                }
                for (const [eid, camera] of state.cameras) {
                    if (world.has(eid, Camera) && world.has(eid, Ascii) && views.has(eid)) continue;
                    const stack = effects.get(eid)?.after;
                    const index = stack?.indexOf(camera.effect) ?? -1;
                    if (index >= 0) stack!.splice(index, 1);
                    camera.buffer.destroy();
                    state.cameras.delete(eid);
                }
            },
        },
    ],
    async warm(world) {
        const state = world.resource(stateKey);
        const device = world.gpu.device;
        state.layout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.FRAGMENT,
                    texture: { sampleType: "float" },
                },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
            ],
        });
        const module = device.createShaderModule({ code: shader });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [state.layout] });
        for (const format of new Set<GPUTextureFormat>([
            "rgba8unorm",
            navigator.gpu.getPreferredCanvasFormat(),
        ])) {
            const pipeline = device.createRenderPipeline({
                layout,
                vertex: { module, entryPoint: "vertex" },
                fragment: { module, entryPoint: "fragment", targets: [{ format }] },
            });
            state.pipelines.set(format, pipeline);
            precompile(world, `ascii-${format}`, () => [pipeline]);
        }
    },
    dispose(world) {
        const state = world.resource(stateKey);
        for (const [eid, camera] of state.cameras) {
            const stack = world.resource(EffectPasses).get(eid)?.after;
            const index = stack?.indexOf(camera.effect) ?? -1;
            if (index >= 0) stack!.splice(index, 1);
            camera.buffer.destroy();
        }
        state.cameras.clear();
        state.pipelines.clear();
        state.layout = null;
    },
};
