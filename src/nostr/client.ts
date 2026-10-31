import type { DeckIndex } from "../audio/types.js";
import {
  B2bRoomGuard,
  computeDriftAction,
  decodeDeckDeltaHex,
  encodeDeckDeltaHex,
  KIND_CLOCK_SYNC,
  KIND_DECK_DELTA,
  KIND_JOIN_REQUEST,
  KIND_ROOM_SNAPSHOT,
  WIRE_VERSION,
  type DeckDeltaPacket,
  type DriftAction,
} from "./sync.js";

export interface NostrUnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface NostrSignedEvent extends NostrUnsignedEvent {
  id: string;
  sig: string;
}

export type EventSigner = (unsigned: NostrUnsignedEvent) => Promise<NostrSignedEvent>;

export interface RemoteDeckUpdate {
  senderPubkey: string;
  packet: DeckDeltaPacket;
  driftAction: DriftAction;
}

export interface ClockSyncPayload {
  type: "ping" | "pong";
  t0: number;
  t1?: number;
  t2?: number;
}

/**
 * NTP-style clock offset: offset = ((t1 - t0) + (t2 - t3)) / 2, rtt = (t3 - t0) - (t2 - t1).
 * Reports the offset of the lowest-RTT sample (least queueing delay) over the last 5 samples.
 */
export class ClockOffsetEstimator {
  private samples: { rtt: number; offset: number }[] = [];
  private readonly maxSamples = 5;

  recordSample(t0: number, t1: number, t2: number, t3: number): number {
    const rtt = Math.max(0, t3 - t0 - Math.max(0, t2 - t1));
    const offset = Math.round(((t1 - t0) + (t2 - t3)) / 2);
    this.samples.push({ rtt, offset });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    return this.offsetMs();
  }

  offsetMs(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    return sorted[0].offset;
  }
}

/**
 * Throttles outgoing `kind 21342` fader updates to at most 10 Hz (`100 ms` min interval),
 * while allowing immediate transmission on discrete edges (`playing`, `mute_mask`, `explicit_seek`)
 * and a 1 Hz (`1000 ms`) heartbeat while playing.
 */
export class DeckDeltaThrottle {
  private lastSentMs: [number, number, number, number] = [0, 0, 0, 0];
  private seqCounter: [number, number, number, number] = [0, 0, 0, 0];
  private pendingDirty: [DeckDeltaPacket | null, DeckDeltaPacket | null, DeckDeltaPacket | null, DeckDeltaPacket | null] =
    [null, null, null, null];

  static readonly FADER_MIN_INTERVAL_MS = 100; // 10 Hz max during drag
  static readonly HEARTBEAT_INTERVAL_MS = 1000; // 1 Hz while playing

  nextSeq(deck: DeckIndex): number {
    this.seqCounter[deck] = (this.seqCounter[deck] + 1) >>> 0;
    return this.seqCounter[deck];
  }

  /**
   * Queues a fader change or immediate edge. Returns the packet immediately if
   * `immediate === true` or `>= 100 ms` have elapsed since the last send on `deck`.
   */
  stage(
    deck: DeckIndex,
    state: Omit<DeckDeltaPacket, "version" | "seq" | "sent_ms">,
    nowMs: number,
    immediate: boolean,
  ): DeckDeltaPacket | null {
    const elapsed = nowMs - this.lastSentMs[deck];
    if (immediate || elapsed >= DeckDeltaThrottle.FADER_MIN_INTERVAL_MS) {
      return this.commit(deck, state, nowMs);
    }
    this.pendingDirty[deck] = {
      ...state,
      version: WIRE_VERSION,
      seq: 0,
      sent_ms: nowMs >>> 0,
    };
    return null;
  }

  /** Periodic tick (call every 50–100 ms): flushes throttled fader state or 1 Hz playing heartbeat. */
  flushDue(
    deck: DeckIndex,
    currentState: Omit<DeckDeltaPacket, "version" | "seq" | "sent_ms">,
    nowMs: number,
  ): DeckDeltaPacket | null {
    const elapsed = nowMs - this.lastSentMs[deck];
    if (this.pendingDirty[deck] && elapsed >= DeckDeltaThrottle.FADER_MIN_INTERVAL_MS) {
      this.pendingDirty[deck] = null;
      return this.commit(deck, currentState, nowMs);
    }
    if (currentState.playing && elapsed >= DeckDeltaThrottle.HEARTBEAT_INTERVAL_MS) {
      return this.commit(deck, { ...currentState, explicit_seek: false }, nowMs);
    }
    return null;
  }

  private commit(
    deck: DeckIndex,
    state: Omit<DeckDeltaPacket, "version" | "seq" | "sent_ms">,
    nowMs: number,
  ): DeckDeltaPacket {
    this.lastSentMs[deck] = nowMs;
    this.pendingDirty[deck] = null;
    return {
      ...state,
      version: WIRE_VERSION,
      seq: this.nextSeq(deck),
      sent_ms: nowMs >>> 0,
    };
  }
}

export class NostrB2bClient {
  private ws: WebSocket | null = null;
  readonly guard = new B2bRoomGuard();
  readonly clock = new ClockOffsetEstimator();
  readonly throttle = new DeckDeltaThrottle();
  private seenIds = new Set<string>();

  constructor(
    readonly roomId: string,
    readonly localPubkey: string,
    readonly sampleRate: number,
    private readonly signer: EventSigner,
    private readonly getLocalDeckPos: (deck: DeckIndex) => number,
    private readonly onRemoteUpdate: (update: RemoteDeckUpdate) => void,
    private readonly onJoinRequest?: () => void,
  ) {}

  connect(relayUrl: string): void {
    this.disconnect();
    const ws = new WebSocket(relayUrl);
    this.ws = ws;

    ws.onopen = () => {
      const subId = `b2b-${this.roomId}`;
      ws.send(
        JSON.stringify([
          "REQ",
          subId,
          {
            kinds: [KIND_DECK_DELTA, KIND_CLOCK_SYNC, KIND_JOIN_REQUEST, KIND_ROOM_SNAPSHOT],
            "#t": [this.roomId],
          },
        ]),
      );
      void this.sendClockPing();
      void this.sendJoinRequest();
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(ev.data) as unknown[];
        if (!Array.isArray(msg) || msg[0] !== "EVENT" || typeof msg[2] !== "object") return;
        this.handleRelayEvent(msg[2] as NostrSignedEvent);
      } catch {
        // Ignore malformed relay frames
      }
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  handleRelayEvent(event: NostrSignedEvent): void {
    if (!event.id || this.seenIds.has(event.id)) return;
    this.seenIds.add(event.id);
    if (event.pubkey === this.localPubkey) return;

    const nowMs = Date.now() >>> 0;

    if (event.kind === KIND_DECK_DELTA) {
      const pkt = decodeDeckDeltaHex(event.content);
      if (!this.guard.acceptEvent(event.pubkey, pkt)) return;
      const localPos = this.getLocalDeckPos(pkt.deck);
      const driftAction = computeDriftAction(
        pkt,
        localPos,
        nowMs,
        this.clock.offsetMs(),
        this.sampleRate,
      );
      this.onRemoteUpdate({ senderPubkey: event.pubkey, packet: pkt, driftAction });
    } else if (event.kind === KIND_CLOCK_SYNC) {
      const payload = JSON.parse(event.content) as ClockSyncPayload;
      if (payload.type === "ping") {
        void this.publishEvent(
          KIND_CLOCK_SYNC,
          JSON.stringify({ type: "pong", t0: payload.t0, t1: nowMs, t2: Date.now() >>> 0 }),
        );
      } else if (
        payload.type === "pong" &&
        typeof payload.t0 === "number" &&
        typeof payload.t1 === "number" &&
        typeof payload.t2 === "number"
      ) {
        this.clock.recordSample(payload.t0, payload.t1, payload.t2, nowMs);
      }
    } else if (event.kind === KIND_JOIN_REQUEST) {
      this.onJoinRequest?.();
    }
  }

  async publishDeckPacket(pkt: DeckDeltaPacket): Promise<void> {
    const hex = encodeDeckDeltaHex(pkt);
    await this.publishEvent(KIND_DECK_DELTA, hex);
  }

  async sendClockPing(): Promise<void> {
    const payload: ClockSyncPayload = { type: "ping", t0: Date.now() >>> 0 };
    await this.publishEvent(KIND_CLOCK_SYNC, JSON.stringify(payload));
  }

  async sendJoinRequest(): Promise<void> {
    await this.publishEvent(KIND_JOIN_REQUEST, "");
  }

  private async publishEvent(kind: number, content: string): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const unsigned: NostrUnsignedEvent = {
      pubkey: this.localPubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind,
      tags: [["t", this.roomId]],
      content,
    };
    const signed = await this.signer(unsigned);
    this.ws.send(JSON.stringify(["EVENT", signed]));
  }
}
