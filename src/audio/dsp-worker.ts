import init, {
  match_master,
  remix,
  stem_split,
} from "@wasm/forge_audio_wasm_v3.js";
import { renderMixPcm } from "./offline-mix.js";
import {
  assertWithin300sCap,
  type WorkerRequest,
  type WorkerResponse,
} from "./types.js";

let initialized = false;

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const post = (msg: WorkerResponse, transfer?: Transferable[]) => {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
  };

  try {
    if (!initialized) {
      await init();
      initialized = true;
    }

    if (req.op === "RENDER_MIX") {
      const { left, right } = renderMixPcm({
        sampleRate: req.sample_rate,
        frames: req.frames,
        crossfader_pmy: req.crossfader_pmy,
        decks: req.decks,
      });
      post({ id: req.id, ok: true, op: "RENDER_MIX", left, right }, [left.buffer, right.buffer]);
      return;
    }

    assertWithin300sCap(req.buf.length, req.sample_rate);

    if (req.op === "STEM_SPLIT") {
      const res = stem_split(req.buf, req.sample_rate) as { a: Float32Array; b: Float32Array };
      post(
        { id: req.id, ok: true, op: "STEM_SPLIT", a: res.a, b: res.b },
        [res.a.buffer, res.b.buffer],
      );
    } else if (req.op === "REMIX") {
      const out = remix(req.buf, req.sample_rate, req.target);
      post({ id: req.id, ok: true, op: "REMIX", out }, [out.buffer]);
    } else if (req.op === "MATCH_MASTER") {
      assertWithin300sCap(req.reference.length, req.sample_rate);
      const out = match_master(req.buf, req.reference, req.sample_rate);
      post({ id: req.id, ok: true, op: "MATCH_MASTER", out }, [out.buffer]);
    }
  } catch (err) {
    post({ id: req.id, ok: false, error: String(err) });
  }
};
