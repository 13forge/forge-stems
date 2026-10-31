import workletUrl from "../audio/worklet-processor.ts?worker&url";
import { RemixAudioBridge } from "../audio/bridge.js";
import { encodeWavPcm16 } from "../audio/export.js";
import { alignedStems, stemFrameCount } from "../audio/stems.js";
import {
  DECK_LETTERS,
  STEM_GAIN_MAX_PMY,
  UNIT_PMY,
  type DeckIndex,
  type FxPreset,
  type FxSlotIndex,
  type OfflineDeckSpec,
  type StemIndex,
} from "../audio/types.js";
import { encodeDeckDeltaHex } from "../nostr/sync.js";
import { BLACK_FLOOR_HEX, RemixController } from "../state/controller.js";
import { decodeMixFragment, encodeMixFragment } from "../state/share.js";

const FADER_STEP = 100;

/** Plain-language primary labels. Stem index 3 is "Music" in the UI (see RemixController.muteMask). */
const SONG_LABELS = ["Song 1", "Song 2", "Song 3", "Song 4"] as const;
const STEM_LABELS = ["Drums", "Bass", "Voice", "Music"] as const;
const PACE_NEUTRAL_CBPM = 12_000;
const FX_PRESETS: readonly FxPreset[] = [
  "echo",
  "warm",
  "far-away",
  "glitch",
  "freeze",
  "hollow",
  "dread",
  "shatter",
];

function asDeck(value: string | undefined): DeckIndex | null {
  const n = Number(value);
  if (n === 0 || n === 1 || n === 2 || n === 3) return n;
  return null;
}

/** Bookmark and FX slot index, 0..=3 as shown in the UI. */
function asSlot(value: string | undefined): FxSlotIndex | null {
  const n = Number(value);
  if (n === 0 || n === 1 || n === 2 || n === 3) return n;
  return null;
}

function asStem(value: string | undefined): StemIndex | null {
  const n = Number(value);
  if (n === 0 || n === 1 || n === 2 || n === 3) return n;
  return null;
}

function pct(pmy: number): string {
  return RemixController.formatPermyriadPct(pmy);
}

function bpmLabel(cbpm: number): string {
  return `${(cbpm / 100).toFixed(2)} BPM`;
}

export function mountRemixShell(root: HTMLElement): {
  controller: RemixController;
  bridge: RemixAudioBridge;
} {
  const incoming = decodeMixFragment(globalThis.location?.hash ?? "");
  const hashPresent = (globalThis.location?.hash ?? "").length > 1;
  const controller = new RemixController(incoming ?? undefined);
  const bridge = new RemixAudioBridge();
  let seqCounter = 1;

  const drawerLabel = (open: boolean) => (open ? "Less" : "+ More Controls");

  const stripHtml = (deck: DeckIndex, stem: StemIndex): string => {
    const state = controller.decks[deck];
    const label = STEM_LABELS[stem];
    const gain = state.gain_pmy[stem];
    return `
      <div class="stem-strip" data-stem-strip="${stem}" data-deck="${deck}" data-dimmed="false" data-soloed="${state.solo[stem]}">
        <div class="stem-head">
          <span class="label-primary">${label}</span>
          <output class="label-secondary-metric" id="val-${deck}-${stem}">${pct(gain)}</output>
        </div>
        <button type="button" class="stem-drop" data-deck="${deck}" data-stem="${stem}" aria-label="Load ${label.toLowerCase()} into ${SONG_LABELS[deck]}">Drop a file</button>
        <input class="stem-file" type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.aiff,.aif,.m4a,.aac" data-deck="${deck}" data-stem="${stem}" tabindex="-1" aria-hidden="true" />
        <input
          class="stem-fader"
          type="range"
          data-slider="stem-gain"
          data-neutral="10000"
          data-deck="${deck}"
          data-stem="${stem}"
          min="0"
          max="${STEM_GAIN_MAX_PMY}"
          step="${FADER_STEP}"
          value="${gain}"
          aria-label="${SONG_LABELS[deck]} ${label.toLowerCase()} level"
        />
        <div class="stem-toggles">
          <button type="button" data-action="stem-mute" data-deck="${deck}" data-stem="${stem}" aria-pressed="${state.muted[stem]}" aria-label="Mute ${label.toLowerCase()} in ${SONG_LABELS[deck]}">Mute</button>
          <button type="button" data-action="stem-solo" data-deck="${deck}" data-stem="${stem}" aria-pressed="${state.solo[stem]}" aria-label="Only hear ${label.toLowerCase()} in ${SONG_LABELS[deck]}">Only This</button>
        </div>
      </div>`;
  };

  const songHtml = (deck: DeckIndex): string => {
    const state = controller.decks[deck];
    const letter = DECK_LETTERS[deck];
    const hidden = deck >= 2 ? " hidden" : "";
    return `
      <article class="song-card" data-song-card="${deck}" data-deck="${deck}" data-playing="${state.playing}"${hidden}>
        <header class="song-head">
          <div>
            <h2 class="label-primary">${SONG_LABELS[deck]}</h2>
            <p class="label-secondary-metric">Deck ${letter}</p>
          </div>
          <button type="button" class="deck-play" data-deck="${deck}" aria-pressed="${state.playing}" aria-label="${state.playing ? "Stop" : "Play"} ${SONG_LABELS[deck]}">${state.playing ? "Stop" : "Play"}</button>
        </header>
        <label class="song-volume">
          <span class="label-primary">Song Volume</span>
          <input class="deck-volume" type="range" data-slider="song-volume" data-neutral="10000" data-deck="${deck}" min="0" max="${UNIT_PMY}" step="${FADER_STEP}" value="${state.volume_pmy}" aria-label="${SONG_LABELS[deck]} volume" />
          <output class="label-secondary-metric" id="vol-${deck}">${pct(state.volume_pmy)}</output>
        </label>
        <div class="stems-grid">${([0, 1, 2, 3] as const).map((stem) => stripHtml(deck, stem)).join("")}</div>
        <button type="button" data-action="toggle-pro" data-deck="${deck}" aria-expanded="false" aria-controls="pro-${deck}">${drawerLabel(false)}</button>
        <div class="pro-drawer" id="pro-${deck}" data-tier2="song-pro" data-deck="${deck}" hidden>
          <label class="pro-control">
            <span class="label-primary">Pace</span>
            <span class="label-secondary-metric" id="pace-${deck}">${bpmLabel(state.bpm_cbpm)}</span>
            <input type="range" data-slider="pace" data-neutral="${PACE_NEUTRAL_CBPM}" data-deck="${deck}" min="4000" max="24000" step="10" value="${state.bpm_cbpm}" aria-label="${SONG_LABELS[deck]} pace" />
          </label>
          <label class="pro-control">
            <span class="label-primary">Tone Sweep</span>
            <span class="label-secondary-metric" id="tone-${deck}">${state.filter_pmy}</span>
            <input type="range" data-slider="tone-sweep" data-neutral="0" data-deck="${deck}" min="-10000" max="10000" step="100" value="${state.filter_pmy}" aria-label="${SONG_LABELS[deck]} tone sweep. Left is warm, right is bright." />
          </label>
          <button type="button" data-action="beat-lock" data-deck="${deck}" aria-pressed="${state.beat_snap}">Lock to Beat</button>
          <button type="button" data-action="keylock" data-deck="${deck}" aria-pressed="${state.keylock}">Keep Original Pitch</button>
          <div class="repeat-row" data-deck="${deck}">
            <span class="label-primary">Repeat Section</span>
            <button type="button" data-action="repeat-toggle" data-deck="${deck}" aria-pressed="${state.loop.enabled}">Repeat</button>
            <button type="button" data-action="repeat-half" data-deck="${deck}" aria-label="Shorter, half length">Shorter ½x</button>
            <button type="button" data-action="repeat-double" data-deck="${deck}" aria-label="Longer, double length">Longer 2x</button>
          </div>
          <div class="bookmark-row" data-deck="${deck}">
            <span class="label-primary">Bookmarks</span>
            ${([0, 1, 2, 3] as const)
              .map(
                (slot) => `<span class="bookmark">
              <button type="button" data-action="bookmark" data-deck="${deck}" data-slot="${slot}" data-saved="${state.hotcues[slot] !== null}">${state.hotcues[slot] === null ? `+ Save Spot ${slot + 1}` : `Jump ${slot + 1}`}</button>
              <button type="button" data-action="bookmark-clear" data-deck="${deck}" data-slot="${slot}" aria-label="Clear bookmark ${slot + 1}">×</button>
            </span>`,
              )
              .join("")}
          </div>
        </div>
      </article>`;
  };

  const fxHtml = ([0, 1, 2, 3] as const)
    .map((slot) => {
      const on = controller.fxSlots[slot].enabled;
      return `<button type="button" data-action="fx-slot" data-slot="${slot}" aria-pressed="${on}" data-active="${on}">Slot ${slot + 1}</button>`;
    })
    .join("");

  root.innerHTML = `
    <a class="skip" href="#decks">Skip to songs</a>
    <main class="shell-root">
      <section class="top-bar" data-zone="top-bar" aria-label="Top bar">
        <div class="brand">
          <p class="brand-kicker label-secondary-metric">13FORGE</p>
          <h1 class="label-primary">Stem Mixer</h1>
        </div>
        <div class="meters" aria-label="Master level and spectrum">
          <canvas id="spectrum-canvas" width="640" height="72" aria-hidden="true"></canvas>
          <div class="rms-col">
            <div class="rms-track" aria-hidden="true"><div id="rms-fill"></div></div>
            <span class="rms-badge label-secondary-metric" id="rms-readout">RMS 0.000</span>
          </div>
        </div>
        <div class="header-actions">
          <button type="button" id="btn-init-audio">Arm Audio</button>
          <button type="button" id="btn-share">Share Mix Link</button>
          <button type="button" id="btn-export-wav" class="primary">Save Mix (WAV)</button>
        </div>
        <input id="share-field" class="share-field" type="text" readonly hidden aria-label="Share link" />
      </section>

      <section class="songs" data-zone="songs" id="decks" aria-label="Songs">
        ${([0, 1, 2, 3] as const).map((deck) => songHtml(deck)).join("")}
      </section>

      <section class="blend-bar" data-zone="blend-bar" aria-label="Blend">
        <div class="blend-track">
          <span class="label-primary">${SONG_LABELS[0]}</span>
          <input id="crossfader" type="range" data-slider="blend" data-neutral="5000" min="0" max="${UNIT_PMY}" step="${FADER_STEP}" value="${controller.crossfader_pmy}" aria-label="Blend. Left is Song 1 and Song 3. Right is Song 2 and Song 4." />
          <span class="label-primary">${SONG_LABELS[1]}</span>
        </div>
        <span class="label-primary">Blend</span>
        <output id="crossfader-readout" class="label-secondary-metric">${RemixController.formatCrossfader(controller.crossfader_pmy)}</output>
        <label class="blend-style">
          <span class="label-primary">Blend Style</span>
          <select id="blend-style" data-action="blend-style" aria-label="Blend style">
            <option value="smooth"${controller.crossfaderCurve === "smooth" ? " selected" : ""}>Smooth</option>
            <option value="sharp"${controller.crossfaderCurve === "sharp" ? " selected" : ""}>Instant Cut</option>
          </select>
        </label>
        <button type="button" data-action="toggle-4-songs" aria-pressed="false">+ Add Songs 3 &amp; 4</button>
      </section>

      <section class="fx-drawer" data-zone="fx-drawer" aria-label="Sound effects">
        <button type="button" data-action="toggle-fx-drawer" aria-expanded="false" aria-controls="fx-body">Sound Effects</button>
        <div class="fx-body" id="fx-body" data-tier2="fx-body" hidden>
          ${fxHtml}
          <label class="pro-control">
            <span class="label-primary">Effect Strength</span>
            <input type="range" data-slider="fx-strength" data-neutral="0" min="0" max="${UNIT_PMY}" step="${FADER_STEP}" value="0" aria-label="Effect strength for all sound effect slots" />
          </label>
          ${([0, 1, 2, 3] as const)
            .map(
              (slot) => `<label class="pro-control">
            <span class="label-primary">Effect ${slot + 1} style</span>
            <select data-action="fx-preset" data-slot="${slot}" aria-label="Effect ${slot + 1} style">
              ${FX_PRESETS.map((p) => `<option value="${p}"${p === controller.fxSlots[slot].preset ? " selected" : ""}>${p}</option>`).join("")}
            </select>
          </label>`,
            )
            .join("")}
        </div>
      </section>

      <section class="studio-panel" aria-label="Offline vocal studio">
        <div class="deck-top">
          <h2>VOCAL STUDIO</h2>
          <div class="deck-actions">
            <button type="button" id="btn-run-remix">RUN REMIX</button>
            <button type="button" id="btn-match-master">MATCH MASTER</button>
          </div>
        </div>
        <p class="studio-note">Offline tools for Song 1. A result replaces the Music stem so you can solo it. The share link never includes the audio.</p>
        <div class="remix-controls">
          <label>Target BPM <input id="remix-bpm" type="number" min="0" max="240" step="0.1" value="${controller.remixTarget.target_bpm}" /></label>
          <label>Camelot key <input id="remix-key" type="text" maxlength="3" value="${controller.remixTarget.target_key}" /></label>
          <label>Loudness LUFS <input id="remix-lufs" type="number" min="-30" max="0" step="0.5" value="${controller.remixTarget.loudness_lufs}" /></label>
          <div class="ref-pick">
            <span>Reference</span>
            <button type="button" id="btn-ref">PICK REFERENCE</button>
            <input id="ref-file-input" class="stem-file" type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.aiff,.aif,.m4a,.aac" tabindex="-1" aria-hidden="true" />
          </div>
        </div>
      </section>

      <footer class="status-bar">
        <p id="status-msg" role="status"></p>
        <p id="key-help" class="label-secondary-metric">Keys: 1–4 focus a song · Space plays the focused song · M mute · S only this · arrows move the focused slider</p>
        <p id="nostr-delta-preview" class="label-secondary-metric">NOSTR 21342: —</p>
      </footer>
    </main>
  `;

  const statusMsg = root.querySelector<HTMLElement>("#status-msg");
  const nostrPreview = root.querySelector<HTMLElement>("#nostr-delta-preview");
  const rmsReadout = root.querySelector<HTMLElement>("#rms-readout");
  const rmsFill = root.querySelector<HTMLElement>("#rms-fill");
  const armButton = root.querySelector<HTMLButtonElement>("#btn-init-audio");

  const setStatus = (text: string) => {
    if (statusMsg) statusMsg.textContent = text;
  };

  if (incoming) {
    setStatus("Mix settings restored from the link. Drop audio on this machine to hear them.");
  } else if (hashPresent) {
    setStatus("That share link could not be read. Starting from a centered mix.");
  } else {
    setStatus("Drop a stem on any song, then play. Audio never leaves this browser.");
  }

  const updateNostrPreview = (deck: DeckIndex, explicitSeek = false) => {
    const state = controller.decks[deck];
    const hex = encodeDeckDeltaHex({
      version: 1,
      deck,
      playing: state.playing,
      mute_mask: controller.muteMask(deck),
      explicit_seek: explicitSeek,
      seq: seqCounter++,
      sent_ms: Math.floor(performance.now()) >>> 0,
      pos_frames: 0,
      gain_pmy: [...state.gain_pmy],
    });
    if (nostrPreview) {
      nostrPreview.textContent = `NOSTR 21342 [${SONG_LABELS[deck]}]: ${hex.slice(0, 16)}…`;
    }
  };

  const paintStem = (deck: DeckIndex, stem: StemIndex) => {
    const state = controller.decks[deck];
    const d = String(deck);
    const s = String(stem);
    const fader = root.querySelector<HTMLInputElement>(`.stem-fader[data-deck="${d}"][data-stem="${s}"]`);
    if (fader) fader.value = String(state.gain_pmy[stem]);
    const readout = root.querySelector<HTMLOutputElement>(`#val-${d}-${s}`);
    if (readout) readout.textContent = pct(state.gain_pmy[stem]);
    root
      .querySelector<HTMLButtonElement>(`[data-action="stem-mute"][data-deck="${d}"][data-stem="${s}"]`)
      ?.setAttribute("aria-pressed", String(state.muted[stem]));
    root
      .querySelector<HTMLButtonElement>(`[data-action="stem-solo"][data-deck="${d}"][data-stem="${s}"]`)
      ?.setAttribute("aria-pressed", String(state.solo[stem]));
    const strip = root.querySelector<HTMLElement>(`[data-stem-strip="${s}"][data-deck="${d}"]`);
    if (strip) {
      strip.dataset.dimmed = String(controller.effectiveMuted(deck, stem));
      strip.dataset.soloed = String(state.solo[stem]);
    }
    const drop = root.querySelector<HTMLButtonElement>(`.stem-drop[data-deck="${d}"][data-stem="${s}"]`);
    const name = state.stemNames[stem];
    if (drop) {
      drop.textContent = name ?? "Drop a file";
      drop.dataset.loaded = name ? "true" : "false";
      if (name) drop.title = name;
      else drop.removeAttribute("title");
    }
  };

  const paintDeck = (deck: DeckIndex) => {
    const state = controller.decks[deck];
    const d = String(deck);
    const card = root.querySelector<HTMLElement>(`[data-song-card="${d}"]`);
    if (card) card.dataset.playing = String(state.playing);
    const play = root.querySelector<HTMLButtonElement>(`.deck-play[data-deck="${d}"]`);
    if (play) {
      play.setAttribute("aria-pressed", String(state.playing));
      play.textContent = state.playing ? "Stop" : "Play";
      play.setAttribute("aria-label", `${state.playing ? "Stop" : "Play"} ${SONG_LABELS[deck]}`);
    }
    const volume = root.querySelector<HTMLInputElement>(`.deck-volume[data-deck="${d}"]`);
    if (volume) volume.value = String(state.volume_pmy);
    const volumeOut = root.querySelector<HTMLOutputElement>(`#vol-${d}`);
    if (volumeOut) volumeOut.textContent = pct(state.volume_pmy);
    const pace = root.querySelector<HTMLInputElement>(`[data-slider="pace"][data-deck="${d}"]`);
    if (pace) pace.value = String(state.bpm_cbpm);
    const paceOut = root.querySelector<HTMLElement>(`#pace-${d}`);
    if (paceOut) paceOut.textContent = bpmLabel(state.bpm_cbpm);
    const tone = root.querySelector<HTMLInputElement>(`[data-slider="tone-sweep"][data-deck="${d}"]`);
    if (tone) tone.value = String(state.filter_pmy);
    const toneOut = root.querySelector<HTMLElement>(`#tone-${d}`);
    if (toneOut) toneOut.textContent = String(state.filter_pmy);
    root
      .querySelector<HTMLButtonElement>(`[data-action="beat-lock"][data-deck="${d}"]`)
      ?.setAttribute("aria-pressed", String(state.beat_snap));
    for (let stem = 0; stem < 4; stem++) paintStem(deck, stem as StemIndex);
  };

  const paintCrossfader = () => {
    const input = root.querySelector<HTMLInputElement>("#crossfader");
    if (input) input.value = String(controller.crossfader_pmy);
    const readout = root.querySelector<HTMLOutputElement>("#crossfader-readout");
    if (readout) readout.textContent = RemixController.formatCrossfader(controller.crossfader_pmy);
  };

  const effectiveMutes = (deck: DeckIndex): [boolean, boolean, boolean, boolean] => [
    controller.effectiveMuted(deck, 0),
    controller.effectiveMuted(deck, 1),
    controller.effectiveMuted(deck, 2),
    controller.effectiveMuted(deck, 3),
  ];

  const pushDeckAudio = (deck: DeckIndex) => {
    if (!bridge.isReady) return;
    const aligned = alignedStems(controller.decks[deck].stems);
    if (!aligned) return;
    const state = controller.decks[deck];
    bridge.loadStems(deck, aligned[0], aligned[1], aligned[2], aligned[3], {
      gain_pmy: [state.gain_pmy[0], state.gain_pmy[1], state.gain_pmy[2], state.gain_pmy[3]],
      muted: effectiveMutes(deck),
      volume_pmy: state.volume_pmy,
      playing: state.playing,
    });
  };

  /** Raw user masks; the worklet applies the solo rule (`any_solo ? !s || m : m`) itself. */
  const pushDeckMutes = (deck: DeckIndex) => {
    if (!bridge.isReady) return;
    bridge.setDeckMuteSoloMasks(deck, controller.muteMask(deck), controller.soloMask(deck));
  };

  const pushAll = () => {
    if (!bridge.isReady) return;
    bridge.setCrossfader(controller.crossfader_pmy);
    for (let deck = 0; deck < 4; deck++) {
      const id = deck as DeckIndex;
      const state = controller.decks[id];
      for (let stem = 0; stem < 4; stem++) {
        bridge.setStemGain(id, stem as StemIndex, state.gain_pmy[stem as StemIndex]);
      }
      pushDeckMutes(id);
      bridge.setDeckLevelPmy(id, state.volume_pmy);
      bridge.setDeckPlaying(id, state.playing);
      bridge.setDeckBpmCbpm(id, state.bpm_cbpm, state.beat_snap);
      bridge.setDeckFilterPmy(id, state.filter_pmy);
      pushDeckAudio(id);
    }
  };

  const markEngineLive = () => {
    if (!armButton) return;
    armButton.textContent = "Engine Live";
    armButton.setAttribute("aria-pressed", "true");
  };

  const ensureBridgeInitialized = async () => {
    const first = !bridge.isReady;
    const wasmUrl = new URL("../../vendor/forge-audio-wasm-v3/forge_audio_wasm_v3_bg.wasm", import.meta.url);
    await bridge.init(wasmUrl, workletUrl);
    if (first) {
      pushAll();
      markEngineLive();
      setStatus(`Engine online at ${bridge.sampleRate} Hz. Faders are permyriad, 100% is unity.`);
    } else if (bridge.isReady) {
      markEngineLive();
    }
  };

  const refreshProcessed = (deck: DeckIndex, sampleRate: number) => {
    const aligned = alignedStems(controller.decks[deck].stems);
    controller.decks[deck].lastSampleRate = sampleRate;
    if (!aligned) {
      controller.decks[deck].lastProcessedMono = null;
      return;
    }
    const [drums, bass, vocal, other] = aligned;
    const sum = new Float32Array(drums.length);
    for (let i = 0; i < sum.length; i++) sum[i] = drums[i] + bass[i] + vocal[i] + other[i];
    controller.decks[deck].lastProcessedMono = sum;
  };

  const loadStemFile = async (deck: DeckIndex, stem: StemIndex, file: File) => {
    try {
      await ensureBridgeInitialized();
      setStatus(`Decoding ${file.name}…`);
      const { pcm, sampleRate } = await bridge.decodeFileToMono(file);
      if (pcm.length === 0) {
        setStatus("That file decoded to silence.");
        return;
      }
      controller.decks[deck].stems[stem] = pcm;
      controller.decks[deck].stemNames[stem] = file.name;
      refreshProcessed(deck, sampleRate);
      paintStem(deck, stem);
      pushDeckAudio(deck);
      const frames = stemFrameCount(controller.decks[deck].stems);
      const seconds = (frames / sampleRate).toFixed(1);
      setStatus(
        `${SONG_LABELS[deck]} ${STEM_LABELS[stem].toLowerCase()} loaded (${seconds}s). Shorter stems on this song pad with silence.`,
      );
      updateNostrPreview(deck, true);
    } catch (err) {
      setStatus(`Could not load that file: ${String(err)}`);
    }
  };

  armButton?.addEventListener("click", async () => {
    try {
      await ensureBridgeInitialized();
    } catch (err) {
      setStatus(`Audio engine failed: ${String(err)}`);
    }
  });

  // ---- Play / song volume / sliders -------------------------------------------------

  root.querySelectorAll<HTMLButtonElement>(".deck-play").forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      if (deck === null) return;
      controller.toggleDeckPlaying(deck);
      paintDeck(deck);
      updateNostrPreview(deck);
      void ensureBridgeInitialized()
        .then(() => {
          if (bridge.isReady) bridge.setDeckPlaying(deck, controller.decks[deck].playing);
        })
        .catch((err) => setStatus(`Audio engine failed: ${String(err)}`));
    });
  });

  /** One handler per slider kind. Double-click calls the same path with the neutral value. */
  const handleSlider = (input: HTMLInputElement) => {
    const kind = input.dataset.slider;
    const deck = asDeck(input.dataset.deck);
    if (kind === "blend") {
      const position = controller.setCrossfader(Number(input.value));
      input.value = String(position);
      const readout = root.querySelector<HTMLOutputElement>("#crossfader-readout");
      if (readout) readout.textContent = RemixController.formatCrossfader(position);
      if (bridge.isReady) bridge.setCrossfader(position);
      return;
    }
    if (kind === "fx-strength") {
      for (let slot = 0; slot < 4; slot++) {
        const intensity = controller.setFxIntensityPmy(slot as FxSlotIndex, Number(input.value));
        input.value = String(intensity);
        if (bridge.isReady) bridge.setFxIntensityPmy(slot as FxSlotIndex, intensity);
      }
      return;
    }
    if (deck === null) return;
    if (kind === "song-volume") {
      const level = controller.setDeckLevelPmy(deck, Number(input.value));
      input.value = String(level);
      const readout = root.querySelector<HTMLOutputElement>(`#vol-${deck}`);
      if (readout) readout.textContent = pct(level);
      if (bridge.isReady) bridge.setDeckLevelPmy(deck, level);
      updateNostrPreview(deck);
    } else if (kind === "stem-gain") {
      const stem = asStem(input.dataset.stem);
      if (stem === null) return;
      const gain = controller.setStemGain(deck, stem, Number(input.value));
      input.value = String(gain);
      const readout = root.querySelector<HTMLOutputElement>(`#val-${deck}-${stem}`);
      if (readout) readout.textContent = pct(gain);
      if (bridge.isReady) bridge.setStemGain(deck, stem, gain);
      updateNostrPreview(deck);
    } else if (kind === "pace") {
      const state = controller.decks[deck];
      const cbpm = controller.setDeckBpmCbpm(deck, Number(input.value), state.beat_snap);
      input.value = String(cbpm);
      const readout = root.querySelector<HTMLElement>(`#pace-${deck}`);
      if (readout) readout.textContent = bpmLabel(cbpm);
      if (bridge.isReady) bridge.setDeckBpmCbpm(deck, cbpm, state.beat_snap);
    } else if (kind === "tone-sweep") {
      const filter = controller.setDeckFilterPmy(deck, Number(input.value));
      input.value = String(filter);
      const readout = root.querySelector<HTMLElement>(`#tone-${deck}`);
      if (readout) readout.textContent = String(filter);
      if (bridge.isReady) bridge.setDeckFilterPmy(deck, filter);
    }
  };

  root.querySelectorAll<HTMLInputElement>("input[data-slider]").forEach((input) => {
    input.addEventListener("input", () => handleSlider(input));
    input.addEventListener("dblclick", () => {
      input.value = input.dataset.neutral ?? "0";
      input.dispatchEvent(new Event("input"));
    });
  });

  // ---- Only This / Mute -------------------------------------------------------------

  const repaintDeckStems = (deck: DeckIndex) => {
    for (let i = 0; i < 4; i++) paintStem(deck, i as StemIndex);
  };

  root.querySelectorAll<HTMLButtonElement>('[data-action="stem-mute"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      const stem = asStem(btn.dataset.stem);
      if (deck === null || stem === null) return;
      controller.toggleStemMute(deck, stem);
      repaintDeckStems(deck);
      pushDeckMutes(deck);
      updateNostrPreview(deck);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="stem-solo"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      const stem = asStem(btn.dataset.stem);
      if (deck === null || stem === null) return;
      controller.toggleStemSolo(deck, stem);
      repaintDeckStems(deck);
      pushDeckMutes(deck);
      updateNostrPreview(deck);
    });
  });

  // ---- Drop / pick stems -------------------------------------------------------------

  root.querySelectorAll<HTMLButtonElement>(".stem-drop").forEach((btn) => {
    const deck = asDeck(btn.dataset.deck);
    const stem = asStem(btn.dataset.stem);
    const input = root.querySelector<HTMLInputElement>(
      `.stem-file[data-deck="${btn.dataset.deck}"][data-stem="${btn.dataset.stem}"]`,
    );
    btn.addEventListener("click", () => input?.click());
    btn.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        input?.click();
      }
    });
    const claim = (file: File | undefined) => {
      if (!file || deck === null || stem === null) return;
      void loadStemFile(deck, stem, file);
    };
    btn.addEventListener("dragover", (event) => {
      event.preventDefault();
      btn.classList.add("is-hot");
    });
    btn.addEventListener("dragleave", () => btn.classList.remove("is-hot"));
    btn.addEventListener("drop", (event) => {
      event.preventDefault();
      btn.classList.remove("is-hot");
      claim(event.dataTransfer?.files?.[0]);
    });
    input?.addEventListener("change", () => {
      claim(input.files?.[0]);
      input.value = "";
    });
  });

  // ---- Drawers and expansion ---------------------------------------------------------

  root.querySelector<HTMLButtonElement>('[data-action="toggle-4-songs"]')?.addEventListener("click", (event) => {
    const btn = event.currentTarget as HTMLButtonElement;
    const open = btn.getAttribute("aria-pressed") !== "true";
    root.querySelectorAll<HTMLElement>('[data-song-card="2"], [data-song-card="3"]').forEach((card) => {
      card.hidden = !open;
    });
    btn.setAttribute("aria-pressed", String(open));
    btn.textContent = open ? "− Hide Songs 3 & 4" : "+ Add Songs 3 & 4";
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="toggle-pro"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      if (deck === null) return;
      const drawer = root.querySelector<HTMLElement>(`[data-tier2="song-pro"][data-deck="${deck}"]`);
      if (!drawer) return;
      drawer.hidden = !drawer.hidden;
      btn.setAttribute("aria-expanded", String(!drawer.hidden));
      btn.textContent = drawerLabel(!drawer.hidden);
    });
  });

  root.querySelector<HTMLButtonElement>('[data-action="toggle-fx-drawer"]')?.addEventListener("click", (event) => {
    const btn = event.currentTarget as HTMLButtonElement;
    const body = root.querySelector<HTMLElement>('[data-tier2="fx-body"]');
    if (!body) return;
    body.hidden = !body.hidden;
    btn.setAttribute("aria-expanded", String(!body.hidden));
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="fx-slot"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const slot = Number(btn.dataset.slot);
      if (slot !== 0 && slot !== 1 && slot !== 2 && slot !== 3) return;
      const on = controller.toggleFxSlot(slot);
      btn.setAttribute("aria-pressed", String(on));
      btn.dataset.active = String(on);
      if (bridge.isReady) bridge.toggleFxSlot(slot);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="beat-lock"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      if (deck === null) return;
      const state = controller.decks[deck];
      const snap = !state.beat_snap;
      controller.setDeckBpmCbpm(deck, state.bpm_cbpm, snap);
      btn.setAttribute("aria-pressed", String(snap));
      if (bridge.isReady) bridge.setDeckBpmCbpm(deck, state.bpm_cbpm, snap);
    });
  });

  // ---- High-ceiling controls (Tier 2) ------------------------------------------------

  root.querySelector<HTMLSelectElement>("#blend-style")?.addEventListener("change", (event) => {
    const select = event.currentTarget as HTMLSelectElement;
    const curve = select.value === "sharp" ? "sharp" : "smooth";
    controller.setCrossfaderCurve(curve);
    if (bridge.isReady) bridge.setCrossfaderCurve(curve === "sharp");
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="keylock"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      if (deck === null) return;
      const on = controller.setDeckKeylock(deck, !controller.decks[deck].keylock);
      btn.setAttribute("aria-pressed", String(on));
      if (bridge.isReady) bridge.setDeckKeylock(deck, on);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="repeat-toggle"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      if (deck === null) return;
      const state = controller.decks[deck];
      const on = !state.loop.enabled;
      let start = state.loop.start_frame;
      let end = state.loop.end_frame;
      if (on && end <= start) {
        start = 0;
        end = stemFrameCount(state.stems);
        if (end === 0) {
          setStatus("Load a song before setting a repeat section.");
          return;
        }
      }
      controller.setDeckLoop(deck, on, start, end);
      const active = controller.decks[deck].loop.enabled;
      btn.setAttribute("aria-pressed", String(active));
      if (bridge.isReady) bridge.setDeckLoop(deck, active, start, end);
    });
  });

  const resizeRepeat = (btn: HTMLButtonElement, direction: -1 | 1) => {
    const deck = asDeck(btn.dataset.deck);
    if (deck === null) return;
    controller.loopResize(deck, direction);
    if (controller.decks[deck].loop.end_frame <= controller.decks[deck].loop.start_frame) {
      setStatus("Turn on Repeat with a loaded song before resizing the section.");
      return;
    }
    if (bridge.isReady) bridge.loopResize(deck, direction);
  };
  root.querySelectorAll<HTMLButtonElement>('[data-action="repeat-half"]').forEach((btn) => {
    btn.addEventListener("click", () => resizeRepeat(btn, -1));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-action="repeat-double"]').forEach((btn) => {
    btn.addEventListener("click", () => resizeRepeat(btn, 1));
  });

  const paintBookmark = (deck: DeckIndex, slot: FxSlotIndex) => {
    const saved = controller.decks[deck].hotcues[slot];
    const btn = root.querySelector<HTMLButtonElement>(
      `[data-action="bookmark"][data-deck="${deck}"][data-slot="${slot}"]`,
    );
    if (!btn) return;
    btn.textContent = saved === null ? `+ Save Spot ${slot + 1}` : `Jump ${slot + 1}`;
    btn.dataset.saved = String(saved !== null);
  };

  root.querySelectorAll<HTMLButtonElement>('[data-action="bookmark"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      const slot = asSlot(btn.dataset.slot);
      if (deck === null || slot === null) return;
      const wasSaved = controller.decks[deck].hotcues[slot] !== null;
      // No playhead telemetry reaches the UI, so a new bookmark saves at the loop start (0 when unset).
      const pos = controller.decks[deck].loop.start_frame;
      const at = controller.triggerOrSetHotcue(deck, slot, pos);
      if (bridge.isReady) {
        bridge.triggerOrSetHotcue(deck, slot, pos);
        if (wasSaved) bridge.setDeckPos(deck, at);
      }
      paintBookmark(deck, slot);
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="bookmark-clear"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      const slot = asSlot(btn.dataset.slot);
      if (deck === null || slot === null) return;
      controller.clearHotcue(deck, slot);
      if (bridge.isReady) bridge.clearHotcue(deck, slot);
      paintBookmark(deck, slot);
    });
  });

  root.querySelectorAll<HTMLSelectElement>('[data-action="fx-preset"]').forEach((sel) => {
    sel.addEventListener("change", () => {
      const slot = asSlot(sel.dataset.slot);
      const preset = FX_PRESETS.find((p) => p === sel.value);
      if (slot === null || preset === undefined) return;
      controller.setFxSlot(slot, preset);
      if (bridge.isReady) bridge.setFxSlot(slot, preset);
    });
  });

  // ---- Keyboard ----------------------------------------------------------------------

  root.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target instanceof HTMLInputElement && (target.type === "text" || target.type === "number")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key >= "1" && event.key <= "4") {
      const deck = Number(event.key) - 1;
      root.querySelector<HTMLButtonElement>(`.deck-play[data-deck="${deck}"]`)?.focus();
      event.preventDefault();
      return;
    }

    if (event.key === " " && target instanceof HTMLInputElement && target.type === "range") {
      const deck = asDeck(target.dataset.deck);
      if (deck === null) return;
      event.preventDefault();
      root.querySelector<HTMLButtonElement>(`.deck-play[data-deck="${deck}"]`)?.click();
      return;
    }

    const key = event.key.toLowerCase();
    if (key !== "m" && key !== "s") return;
    const strip = target.closest<HTMLElement>("[data-stem-strip]");
    if (!strip) return;
    const deck = asDeck(strip.dataset.deck);
    const stem = asStem(strip.dataset.stemStrip);
    if (deck === null || stem === null) return;
    event.preventDefault();
    if (key === "m") controller.toggleStemMute(deck, stem);
    else controller.toggleStemSolo(deck, stem);
    repaintDeckStems(deck);
    pushDeckMutes(deck);
    updateNostrPreview(deck);
  });

  // ---- Share and save ----------------------------------------------------------------

  root.querySelector<HTMLButtonElement>("#btn-share")?.addEventListener("click", async () => {
    const fragment = encodeMixFragment(controller.toMixSettings());
    const url = new URL(globalThis.location.href);
    url.hash = fragment;
    history.replaceState(null, "", url);
    const shareField = root.querySelector<HTMLInputElement>("#share-field");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("ERR_CLIPBOARD_UNAVAILABLE");
      await navigator.clipboard.writeText(url.toString());
      if (shareField) shareField.hidden = true;
      setStatus("Share link copied. It stores faders, mutes, solos, levels, and play state only.");
    } catch {
      if (shareField) {
        shareField.hidden = false;
        shareField.value = url.toString();
        shareField.focus();
        shareField.select();
      }
      setStatus("Clipboard blocked. The link is in the address bar and selected in the field.");
    }
  });

  root.querySelector<HTMLButtonElement>("#btn-export-wav")?.addEventListener("click", async () => {
    try {
      await ensureBridgeInitialized();
    } catch (err) {
      setStatus(`Audio engine failed: ${String(err)}`);
      return;
    }
    const sampleRate = bridge.sampleRate;
    let frames = 0;
    const decks: OfflineDeckSpec[] = ([0, 1, 2, 3] as const).map((deck) => {
      const state = controller.decks[deck];
      const aligned = alignedStems(state.stems);
      const playing = state.playing && aligned !== null;
      if (playing && aligned) frames = Math.max(frames, aligned[0].length);
      const empty = new Float32Array(0);
      return {
        drums: aligned && playing ? aligned[0] : empty,
        bass: aligned && playing ? aligned[1] : empty,
        vocal: aligned && playing ? aligned[2] : empty,
        other: aligned && playing ? aligned[3] : empty,
        gain_pmy: [state.gain_pmy[0], state.gain_pmy[1], state.gain_pmy[2], state.gain_pmy[3]],
        muted: effectiveMutes(deck),
        volume_pmy: state.volume_pmy,
        playing,
      };
    });
    if (frames === 0) {
      setStatus("Press play on a song that has audio, then save. Stopped songs stay out of the bounce.");
      return;
    }
    try {
      setStatus("Rendering the mix from the start of each playing song…");
      const { left, right } = await bridge.renderMix(sampleRate, frames, controller.crossfader_pmy, decks);
      const wavBytes = encodeWavPcm16(left, right, sampleRate);
      const blob = new Blob([wavBytes as Uint8Array<ArrayBuffer>], { type: "audio/wav" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = "forge-stem-mix.wav";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
      const seconds = (frames / sampleRate).toFixed(1);
      setStatus(`Saved ${seconds}s mix (${wavBytes.byteLength} bytes) from the start of the playing songs.`);
    } catch (err) {
      setStatus(`Save refused: ${String(err)}`);
    }
  });

  // ---- Offline studio ----------------------------------------------------------------

  const bpmInput = root.querySelector<HTMLInputElement>("#remix-bpm");
  const keyInput = root.querySelector<HTMLInputElement>("#remix-key");
  const lufsInput = root.querySelector<HTMLInputElement>("#remix-lufs");
  const refInput = root.querySelector<HTMLInputElement>("#ref-file-input");

  bpmInput?.addEventListener("change", () => {
    const value = Number(bpmInput.value);
    if (Number.isFinite(value) && value >= 0) controller.remixTarget.target_bpm = value;
  });
  keyInput?.addEventListener("change", () => {
    controller.remixTarget.target_key = keyInput.value.trim();
  });
  lufsInput?.addEventListener("change", () => {
    const value = Number(lufsInput.value);
    if (Number.isFinite(value)) controller.remixTarget.loudness_lufs = value;
  });
  root.querySelector<HTMLButtonElement>("#btn-ref")?.addEventListener("click", () => refInput?.click());
  refInput?.addEventListener("change", async () => {
    const file = refInput.files?.[0];
    if (!file) return;
    try {
      await ensureBridgeInitialized();
      const { pcm } = await bridge.decodeFileToMono(file);
      controller.referenceBuffer = pcm;
      const refButton = root.querySelector<HTMLButtonElement>("#btn-ref");
      if (refButton) {
        refButton.textContent = file.name;
        refButton.title = file.name;
      }
      setStatus(`Reference loaded (${pcm.length} samples). It stays in memory for Match Master only.`);
    } catch (err) {
      setStatus(`Reference decode failed: ${String(err)}`);
    }
  });

  /** Remix and Match Master land on Song 1's Music stem (index 3, bit 8). */
  const landOnMusic = (name: string, pcm: Float32Array, sampleRate: number) => {
    const deck: DeckIndex = 0;
    controller.decks[deck].stems[3] = pcm;
    controller.decks[deck].stemNames[3] = name;
    controller.decks[deck].lastProcessedMono = pcm;
    controller.decks[deck].lastSampleRate = sampleRate;
    paintDeck(deck);
    pushDeckAudio(deck);
  };

  root.querySelector<HTMLButtonElement>("#btn-run-remix")?.addEventListener("click", async () => {
    const src = controller.decks[0].lastProcessedMono;
    const sampleRate = controller.decks[0].lastSampleRate;
    if (!src) {
      setStatus("Load at least one stem on Song 1 before Remix.");
      return;
    }
    try {
      await ensureBridgeInitialized();
      setStatus("Running Remix in the DSP worker…");
      const out = await bridge.remixTrack(src, sampleRate, controller.remixTarget);
      landOnMusic("remix-result", out, sampleRate);
      setStatus("Remix landed on Song 1 · Music. Only This on Music to hear it alone.");
    } catch (err) {
      setStatus(`Remix failed: ${String(err)}`);
    }
  });

  root.querySelector<HTMLButtonElement>("#btn-match-master")?.addEventListener("click", async () => {
    const src = controller.decks[0].lastProcessedMono;
    const reference = controller.referenceBuffer;
    const sampleRate = controller.decks[0].lastSampleRate;
    if (!src || !reference) {
      setStatus("Load Song 1 and a reference track before Match Master.");
      return;
    }
    try {
      await ensureBridgeInitialized();
      setStatus("Running Match Master in the DSP worker…");
      const out = await bridge.matchMaster(src, reference, sampleRate);
      landOnMusic("match-result", out, sampleRate);
      setStatus("Match Master landed on Song 1 · Music. Only This on Music to audition it.");
    } catch (err) {
      setStatus(`Match Master failed: ${String(err)}`);
    }
  });

  bridge.onError((message) => setStatus(`Engine error: ${message}`));

  // ---- Meters --------------------------------------------------------------------------

  const canvas = root.querySelector<HTMLCanvasElement>("#spectrum-canvas");
  const ctx2d = canvas?.getContext("2d");
  const fitCanvas = () => {
    if (!canvas) return;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };
  if (canvas && ctx2d) {
    fitCanvas();
    ctx2d.fillStyle = BLACK_FLOOR_HEX;
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    window.addEventListener("resize", fitCanvas);
    bridge.onTelemetry((rms, spectrum) => {
      fitCanvas();
      if (rmsReadout) rmsReadout.textContent = `RMS ${rms.toFixed(3)}`;
      if (rmsFill) {
        const pctH = Math.max(0, Math.min(100, rms * 100));
        rmsFill.style.height = `${pctH}%`;
      }
      ctx2d.fillStyle = BLACK_FLOOR_HEX;
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = "#d8a657";
      const bins = Math.min(64, spectrum.length);
      const barW = canvas.width / bins;
      for (let i = 0; i < bins; i++) {
        const h = Math.min(canvas.height, spectrum[i] * canvas.height);
        ctx2d.fillRect(i * barW, canvas.height - h, Math.max(1, barW - 1), h);
      }
    });
  }

  for (let deck = 0; deck < 4; deck++) paintDeck(deck as DeckIndex);
  paintCrossfader();

  return { controller, bridge };
}
