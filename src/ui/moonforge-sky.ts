import skySource from "./shaders/launcher_sky.wgsl?raw";
import type { RemixController } from "../state/controller.js";

/** Live meter values written by app.ts's single telemetry listener. */
export interface SkyMeters {
  rms: number;
  /** Mean of the top spectrum bins, 0..=1. Stands in for the high (voice) band. */
  high: number;
}

export interface MoonforgeSkyHandle {
  readonly active: boolean;
  dispose(): void;
}

const UNIFORM_BYTES = 32; // resolution(8) mouse(8) time(4) pad(12)
const CHANNEL_BYTES = 32; // array<vec4<f32>, 2> = 8 floats
const IDLE_STAR_LIFT = 0.2;
const ACTIVE_STAR_LIFT = 0.9;

interface GpuLike {
  requestAdapter(): Promise<GpuAdapterLike | null>;
  getPreferredCanvasFormat(): string;
}
interface GpuAdapterLike {
  requestDevice(): Promise<GpuDeviceLike>;
}
interface GpuDeviceLike {
  createShaderModule(desc: { code: string }): unknown;
  createBuffer(desc: { size: number; usage: number }): GpuBufferLike;
  createRenderPipeline(desc: unknown): { getBindGroupLayout(i: number): unknown };
  createBindGroup(desc: unknown): unknown;
  createCommandEncoder(): GpuEncoderLike;
  queue: { writeBuffer(buf: GpuBufferLike, off: number, data: BufferSource): void; submit(cmds: unknown[]): void };
}
interface GpuBufferLike {}
interface GpuEncoderLike {
  beginRenderPass(desc: unknown): { setPipeline(p: unknown): void; setBindGroup(i: number, g: unknown): void; draw(n: number): void; end(): void };
  finish(): unknown;
}
interface GpuCanvasLike {
  getContext(kind: "webgpu"): {
    configure(cfg: unknown): void;
    getCurrentTexture(): { createView(): unknown };
  } | null;
}

const UNIFORM_USAGE = 0x40 | 0x8; // UNIFORM | COPY_DST
const CHANNEL_USAGE = 0x40 | 0x8;

function hasWebGpu(): boolean {
  return typeof navigator !== "undefined" && (navigator as unknown as { gpu?: unknown }).gpu !== undefined;
}

/**
 * Mount the Haunted Moonforge sky behind #app. Feature-detects navigator.gpu and
 * returns an inert handle when WebGPU is absent (happy-dom, older browsers).
 */
export async function mountMoonforgeSky(
  root: HTMLElement,
  controller: RemixController,
  meters: SkyMeters,
): Promise<MoonforgeSkyHandle> {
  const inert: MoonforgeSkyHandle = { active: false, dispose() {} };
  if (!hasWebGpu()) return inert;

  const canvas = document.createElement("canvas");
  canvas.dataset.moonforgeSky = "true";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none;";
  root.parentElement?.insertBefore(canvas, root);
  root.style.position = "relative";
  root.style.zIndex = "1";

  const gpu = (navigator as unknown as { gpu: GpuLike }).gpu;
  let device: GpuDeviceLike;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) throw new Error("no adapter");
    device = await adapter.requestDevice();
  } catch {
    canvas.remove();
    root.style.zIndex = "";
    return inert;
  }

  const format = gpu.getPreferredCanvasFormat();
  const ctx = (canvas as unknown as GpuCanvasLike).getContext("webgpu");
  if (!ctx) {
    canvas.remove();
    root.style.zIndex = "";
    return inert;
  }
  ctx.configure({ device, format, alphaMode: "opaque" });

  const module = device.createShaderModule({ code: skySource });
  const pipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vs_main" },
    fragment: { module, entryPoint: "fs_main", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const uniforms = device.createBuffer({ size: UNIFORM_BYTES, usage: UNIFORM_USAGE });
  const channels = device.createBuffer({ size: CHANNEL_BYTES, usage: CHANNEL_USAGE });
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniforms } },
      { binding: 1, resource: { buffer: channels } },
    ],
  });

  const uniformData = new Float32Array(UNIFORM_BYTES / 4);
  const channelData = new Float32Array(CHANNEL_BYTES / 4);
  const start = performance.now();
  let raf = 0;
  let disposed = false;

  const resize = () => {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
  };
  resize();
  window.addEventListener("resize", resize);

  const frame = () => {
    if (disposed) return;
    const playing = controller.decks.some((d) => d.playing);
    // ch(0) star_lift: playing state plus high-band energy.
    const starLift = playing ? Math.max(ACTIVE_STAR_LIFT, meters.high) : IDLE_STAR_LIFT;
    // ch(1) moon_wheel: Blend position, 0..=1.
    const moonWheel = controller.crossfader_pmy / 10_000;
    // ch(2) ground_light: master RMS, clamped.
    const groundLight = Math.max(0, Math.min(1, meters.rms));

    uniformData[0] = canvas.width;
    uniformData[1] = canvas.height;
    uniformData[2] = 0;
    uniformData[3] = 0;
    uniformData[4] = (performance.now() - start) / 1000;
    device.queue.writeBuffer(uniforms, 0, uniformData);

    channelData[0] = starLift;
    channelData[1] = moonWheel;
    channelData[2] = groundLight;
    device.queue.writeBuffer(channels, 0, channelData);

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.0392, g: 0.0275, b: 0.0196, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    active: true,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.remove();
      root.style.zIndex = "";
      root.style.position = "";
    },
  };
}
