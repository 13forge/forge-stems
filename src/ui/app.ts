import workletUrl from "../audio/worklet-processor.ts?worker&url";
import { RemixAudioBridge } from "../audio/bridge.js";
import { encodeWavPcm16 } from "../audio/export.js";
import { oneBarFrames, nextLoopLength, repeatLabel } from "../audio/loop-region.js";
import { paceLabel, PACE_SLIDER_MAX, PACE_SLIDER_UNITY, sliderToTempoPmy, tempoToSlider } from "../audio/pace.js";
import { assignStemFiles, isAudioFile } from "../audio/stem-assign.js";
import { musicOnlyQuartet, quartetHasAudio, splitFullSong, type StemQuartet } from "../audio/stem-split.js";
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
import { mountMoonforgeSky, type SkyMeters } from "./moonforge-sky.js";

const FADER_STEP = 100;
const AUDIO_ACCEPT = "audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.aiff,.aif";

/** Plain-language primary labels. Stem index 3 is "Music" in the UI (see RemixController.muteMask). */
const SONG_LABELS = ["Song 1", "Song 2", "Song 3", "Song 4"] as const;
const STEM_LABELS = ["Drums", "Bass", "Vocals", "Music"] as const;
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

export function mountRemixShell(root: HTMLElement): {
  controller: RemixController;
  bridge: RemixAudioBridge;
} {
  const incoming = decodeMixFragment(globalThis.location?.hash ?? "");
  const hashPresent = (globalThis.location?.hash ?? "").length > 1;
  const controller = new RemixController(incoming ?? undefined);
  const bridge = new RemixAudioBridge();
  const skyMeters: SkyMeters = { rms: 0, high: 0 };
  void mountMoonforgeSky(root, controller, skyMeters).catch(() => undefined);
  let seqCounter = 1;

  const drawerLabel = (open: boolean) => (open ? "Less" : "+ More Controls");

  const stripHtml = (deck: DeckIndex, stem: StemIndex): string => {
    const state = controller.decks[deck];
    const label = STEM_LABELS[stem];
    const gain = state.gain_pmy[stem];
    return `
      <div class="stem-strip stem-drop" data-stem-strip="${stem}" data-deck="${deck}" data-stem="${stem}" data-dimmed="false" data-soloed="${state.solo[stem]}">
        <div class="stem-head">
          <span class="label-primary">${label}</span>
          <output class="label-secondary-metric" id="val-${deck}-${stem}">${pct(gain)}</output>
        </div>
        <span class="stem-file-name" data-deck="${deck}" data-stem="${stem}">Drop a part</span>
        <input class="stem-file" type="file" accept="${AUDIO_ACCEPT}" data-deck="${deck}" data-stem="${stem}" tabindex="-1" aria-hidden="true" />
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
          <button type="button" data-action="stem-mute" data-deck="${deck}" data-stem="${stem}" aria-pressed="${state.muted[stem]}" aria-label="Mute ${label.toLowerCase()} in ${SONG_LABELS[deck]}">${label}</button>
          <button type="button" data-action="stem-solo" data-deck="${deck}" data-stem="${stem}" aria-pressed="${state.solo[stem]}" aria-label="Only hear ${label.toLowerCase()} in ${SONG_LABELS[deck]}">Only This</button>
        </div>
      </div>`;
  };

  const songHtml = (deck: DeckIndex): string => {
    const state = controller.decks[deck];
    const letter = DECK_LETTERS[deck];
    const hidden = deck >= 2 ? " hidden" : "";
    const tempoSlider = tempoToSlider(state.tempo_pmy);
    return `
      <article class="song-card" data-song-card="${deck}" data-deck="${deck}" data-playing="${state.playing}" data-playhead="0" data-loop-start="0" data-loop-end="0" data-tempo-pmy="${state.tempo_pmy}"${hidden}>
        <header class="song-head">
          <div>
            <h2 class="label-primary">${SONG_LABELS[deck]}</h2>
            <p class="label-secondary-metric">Deck ${letter}</p>
          </div>
        </header>
        <section class="step" data-step="1" data-reachable="true">
          <span class="step-num" aria-hidden="true">1</span>
          <div class="step-body">
            <h3 class="label-primary">Add a song</h3>
            <div class="song-drop" data-deck="${deck}">
              <button type="button" class="choose-song" data-action="choose-song" data-deck="${deck}">Load full song (auto-split into 4 parts)</button>
              <p class="drop-hint">Drop to load</p>
              <input class="song-file stem-file" type="file" accept="${AUDIO_ACCEPT}" data-deck="${deck}" data-role="full-song" tabindex="-1" aria-hidden="true" />
            </div>
            <p class="split-badge" data-split-badge data-deck="${deck}" hidden>Splitting 4 stems…</p>
            <p class="split-note" data-split-note data-deck="${deck}" hidden></p>
          </div>
        </section>
        <section class="step" data-step="2" data-reachable="false">
          <span class="step-num" aria-hidden="true">2</span>
          <div class="step-body">
            <h3 class="label-primary">Pick what you hear</h3>
            <p class="step-hint" data-step-hint data-deck="${deck}">Add a song first.</p>
            <div class="stems-grid">${([0, 1, 2, 3] as const).map((stem) => stripHtml(deck, stem)).join("")}</div>
          </div>
        </section>
        <section class="step" data-step="3" data-reachable="false">
          <span class="step-num" aria-hidden="true">3</span>
          <div class="step-body">
            <h3 class="label-primary">Play and loop</h3>
            <p class="step-hint" data-step-hint data-deck="${deck}">Add a song first.</p>
            <button type="button" class="deck-play" data-deck="${deck}" aria-pressed="${state.playing}" aria-label="${state.playing ? "Pause" : "Play"} ${SONG_LABELS[deck]}">${state.playing ? "❚❚ Pause" : "▶ Play"}</button>
            <div class="playhead-bar" data-deck="${deck}" aria-hidden="true">
              <div class="loop-shade" data-deck="${deck}" hidden></div>
              <div class="playhead-tip" data-deck="${deck}"></div>
            </div>
            <div class="repeat-row" data-deck="${deck}">
              <button type="button" data-action="repeat-toggle" data-deck="${deck}" aria-pressed="${state.loop.enabled}">Repeat</button>
              <button type="button" data-action="repeat-half" data-deck="${deck}" aria-pressed="false" aria-label="Shorter, half length">Shorter ½</button>
              <button type="button" data-action="repeat-double" data-deck="${deck}" aria-pressed="false" aria-label="Longer, double length">Longer 2×</button>
            </div>
            <label class="pro-control pace-control">
              <span class="label-primary">Pace</span>
              <span class="label-secondary-metric" id="pace-${deck}">${paceLabel(state.tempo_pmy, state.bpm_cbpm)}</span>
              <input type="range" data-slider="pace" data-neutral="${PACE_SLIDER_UNITY}" data-deck="${deck}" data-tempo-pmy="${state.tempo_pmy}" min="${0}" max="${PACE_SLIDER_MAX}" step="1" value="${tempoSlider}" aria-label="${SONG_LABELS[deck]} pace. Right is faster. Center is original speed." />
            </label>
            <button type="button" data-action="keylock" data-deck="${deck}" aria-pressed="${state.keylock}">Keep Original Pitch</button>
          </div>
        </section>
        <button type="button" data-action="toggle-pro" data-deck="${deck}" aria-expanded="false" aria-controls="pro-${deck}">${drawerLabel(false)}</button>
        <div class="pro-drawer" id="pro-${deck}" data-tier2="song-pro" data-deck="${deck}" hidden>
          <label class="song-volume">
            <span class="label-primary">Song Volume</span>
            <input class="deck-volume" type="range" data-slider="song-volume" data-neutral="10000" data-deck="${deck}" min="0" max="${UNIT_PMY}" step="${FADER_STEP}" value="${state.volume_pmy}" aria-label="${SONG_LABELS[deck]} volume" />
            <output class="label-secondary-metric" id="vol-${deck}">${pct(state.volume_pmy)}</output>
          </label>
          <label class="pro-control">
            <span class="label-primary">Tone Sweep</span>
            <span class="label-secondary-metric" id="tone-${deck}">${state.filter_pmy}</span>
            <input type="range" data-slider="tone-sweep" data-neutral="0" data-deck="${deck}" min="-10000" max="10000" step="100" value="${state.filter_pmy}" aria-label="${SONG_LABELS[deck]} tone sweep. Left is warm, right is bright." />
          </label>
          <button type="button" data-action="beat-lock" data-deck="${deck}" aria-pressed="${state.beat_snap}">Lock to Beat</button>
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
          <button type="button" id="btn-play-all" class="deck-play global-play" aria-pressed="false" aria-label="Play all songs">▶ Play</button>
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
        <div class="fx-row">
          <h2 class="label-primary">Effects</h2>
          <button type="button" data-fx="filter" aria-pressed="false">Filter</button>
          <button type="button" data-fx="echo" aria-pressed="false">Echo</button>
          <button type="button" data-fx="reverb" aria-pressed="false">Reverb</button>
          <button type="button" data-fx="buildup" aria-pressed="false">Build-up</button>
          <p id="fx-readout" class="fx-readout" hidden></p>
        </div>
        <button type="button" data-action="toggle-fx-drawer" aria-expanded="false" aria-controls="fx-body">More effect controls</button>
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
          <label>Target BPM <input id="remix-bpm" class="text-input" type="number" min="0" max="240" step="0.1" value="${controller.remixTarget.target_bpm}" /></label>
          <label>Camelot key <input id="remix-key" class="text-input" type="text" maxlength="3" value="${controller.remixTarget.target_key}" /></label>
          <label>Loudness LUFS <input id="remix-lufs" class="text-input" type="number" min="-30" max="0" step="0.5" value="${controller.remixTarget.loudness_lufs}" /></label>
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
      pos_frames: state.pos_frames >>> 0,
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
    const name = state.stemNames[stem];
    const fileName = root.querySelector<HTMLElement>(`.stem-file-name[data-deck="${d}"][data-stem="${s}"]`);
    if (fileName) fileName.textContent = name ?? "Drop a part";
    const stripName = root.querySelector<HTMLElement>(`.stem-drop[data-deck="${d}"][data-stem="${s}"]`);
    if (stripName) {
      stripName.dataset.loaded = name ? "true" : "false";
      if (name) stripName.title = name;
      else stripName.removeAttribute("title");
    }
  };

  const paintLoop = (deck: DeckIndex) => {
    const state = controller.decks[deck];
    const d = String(deck);
    const on = state.loop.enabled && state.loop.end_frame > state.loop.start_frame;
    const length = Math.max(0, state.loop.end_frame - state.loop.start_frame);
    const label = on ? repeatLabel(length, state.bpm_cbpm, bridge.sampleRate) : "Repeat";
    for (const action of ["repeat-toggle", "repeat-half", "repeat-double"] as const) {
      const btn = root.querySelector<HTMLButtonElement>(`[data-action="${action}"][data-deck="${d}"]`);
      if (!btn) continue;
      btn.setAttribute("aria-pressed", String(on));
      if (action === "repeat-toggle") btn.textContent = label;
    }
    const card = root.querySelector<HTMLElement>(`[data-song-card="${d}"]`);
    if (card) {
      card.dataset.loopStart = String(state.loop.start_frame);
      card.dataset.loopEnd = String(state.loop.end_frame);
    }
  };

  const paintPlayhead = (deck: DeckIndex) => {
    const state = controller.decks[deck];
    const d = String(deck);
    const card = root.querySelector<HTMLElement>(`[data-song-card="${d}"]`);
    const track = Math.max(1, stemFrameCount(state.stems));
    const pos = state.pos_frames;
    if (card) card.dataset.playhead = String(pos);
    const tip = root.querySelector<HTMLElement>(`.playhead-tip[data-deck="${d}"]`);
    if (tip) tip.style.left = `${Math.max(0, Math.min(100, (pos / track) * 100))}%`;
    const shade = root.querySelector<HTMLElement>(`.loop-shade[data-deck="${d}"]`);
    const loop = state.loop;
    if (shade) {
      const active = loop.enabled && loop.end_frame > loop.start_frame;
      shade.hidden = !active;
      if (active) {
        const a = Math.max(0, Math.min(100, (loop.start_frame / track) * 100));
        const b = Math.max(a, Math.min(100, (loop.end_frame / track) * 100));
        shade.style.left = `${a}%`;
        shade.style.width = `${Math.max(0.8, b - a)}%`;
      }
    }
  };

  const paintReach = (deck: DeckIndex) => {
    const loaded = stemFrameCount(controller.decks[deck].stems) > 0;
    const d = String(deck);
    for (const step of [2, 3] as const) {
      const section = root.querySelector<HTMLElement>(`[data-song-card="${d}"] [data-step="${step}"]`);
      if (section) section.dataset.reachable = String(loaded);
      root.querySelectorAll<HTMLElement>(`[data-song-card="${d}"] [data-step="${step}"] [data-step-hint]`).forEach((hint) => {
        hint.hidden = loaded;
      });
    }
  };

  const paintGlobalPlay = () => {
    const any = controller.decks.some((deck) => deck.playing);
    const btn = root.querySelector<HTMLButtonElement>("#btn-play-all");
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(any));
    btn.textContent = any ? "❚❚ Pause" : "▶ Play";
    btn.setAttribute("aria-label", any ? "Pause all songs" : "Play all songs");
  };

  const paintDeck = (deck: DeckIndex) => {
    const state = controller.decks[deck];
    const d = String(deck);
    const card = root.querySelector<HTMLElement>(`[data-song-card="${d}"]`);
    if (card) card.dataset.playing = String(state.playing);
    const play = root.querySelector<HTMLButtonElement>(`.deck-play[data-deck="${d}"]`);
    if (play) {
      play.setAttribute("aria-pressed", String(state.playing));
      play.textContent = state.playing ? "❚❚ Pause" : "▶ Play";
      play.setAttribute("aria-label", `${state.playing ? "Pause" : "Play"} ${SONG_LABELS[deck]}`);
    }
    const volume = root.querySelector<HTMLInputElement>(`.deck-volume[data-deck="${d}"]`);
    if (volume) volume.value = String(state.volume_pmy);
    const volumeOut = root.querySelector<HTMLOutputElement>(`#vol-${d}`);
    if (volumeOut) volumeOut.textContent = pct(state.volume_pmy);
    const pace = root.querySelector<HTMLInputElement>(`[data-slider="pace"][data-deck="${d}"]`);
    if (pace) {
      pace.value = String(tempoToSlider(state.tempo_pmy));
      pace.dataset.tempoPmy = String(state.tempo_pmy);
      pace.style.setProperty("--pct", `${(Number(pace.value) / PACE_SLIDER_MAX) * 100}%`);
    }
    const paceOut = root.querySelector<HTMLElement>(`#pace-${d}`);
    if (paceOut) paceOut.textContent = paceLabel(state.tempo_pmy, state.bpm_cbpm);
    if (card) card.dataset.tempoPmy = String(state.tempo_pmy);
    paintLoop(deck);
    paintPlayhead(deck);
    paintReach(deck);
    paintGlobalPlay();
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
    bridge.setDeckTempoPmy(deck, state.tempo_pmy);
    bridge.setDeckKeylock(deck, state.keylock);
    bridge.setDeckFilterPmy(deck, state.filter_pmy);
    if (state.loop.enabled) {
      bridge.setDeckLoop(deck, true, state.loop.start_frame, state.loop.end_frame);
    }
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
      bridge.setDeckTempoPmy(id, state.tempo_pmy);
      bridge.setDeckKeylock(id, state.keylock);
      pushDeckAudio(id);
    }
    for (let slot = 0; slot < 4; slot++) {
      const fxSlot = slot as FxSlotIndex;
      const fx = controller.fxSlots[fxSlot];
      bridge.armFxSlot(fxSlot, fx.preset, fx.intensity_pmy, fx.enabled);
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
      const tick = () => {
        for (let deck = 0; deck < 4; deck++) paintPlayhead(deck as DeckIndex);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
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
      paintReach(deck);
    } catch (err) {
      setStatus(`Could not load that file: ${String(err)}`);
    }
  };

  const applyQuartet = (deck: DeckIndex, parts: StemQuartet, label: string) => {
    const state = controller.decks[deck];
    state.stems[0] = parts.drums.length ? parts.drums : null;
    state.stems[1] = parts.bass.length ? parts.bass : null;
    state.stems[2] = parts.voice.length ? parts.voice : null;
    state.stems[3] = parts.music.length ? parts.music : null;
    state.stemNames[0] = parts.drums.length ? `${label} · drums` : null;
    state.stemNames[1] = parts.bass.length ? `${label} · bass` : null;
    state.stemNames[2] = parts.voice.length ? `${label} · vocals` : null;
    state.stemNames[3] = parts.music.length ? `${label} · music` : null;
  };

  const setSplitBadge = (deck: DeckIndex, on: boolean) => {
    const badge = root.querySelector<HTMLElement>(`[data-split-badge][data-deck="${deck}"]`);
    if (badge) badge.hidden = !on;
  };

  const setSplitNote = (deck: DeckIndex, text: string | null) => {
    const note = root.querySelector<HTMLElement>(`[data-split-note][data-deck="${deck}"]`);
    if (!note) return;
    if (!text) {
      note.hidden = true;
      note.textContent = "";
      return;
    }
    note.hidden = false;
    note.textContent = text;
  };

  const loadedStemCount = (deck: DeckIndex) =>
    controller.decks[deck].stems.filter((stem) => stem && stem.length > 0).length;

  /** One mixed file. Tries stem_split_four in a worker, otherwise parks the song on Music. */
  const loadFullSong = async (deck: DeckIndex, file: File) => {
    setSplitBadge(deck, true);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    try {
      await ensureBridgeInitialized();
      setStatus(`Decoding ${file.name}…`);
      const { pcm, sampleRate } = await bridge.decodeFileToMono(file);
      if (pcm.length === 0) {
        setStatus("That file decoded to silence.");
        return;
      }
      const result = await splitFullSong(pcm, sampleRate);
      if (result.ok && quartetHasAudio(result)) {
        applyQuartet(deck, result, file.name);
        setSplitNote(deck, null);
        setStatus(`${SONG_LABELS[deck]} split into Drums, Bass, Vocals, and Music.`);
      } else {
        applyQuartet(deck, musicOnlyQuartet(pcm), file.name);
        const note = "Auto-split needs the updated engine";
        setSplitNote(deck, `${note}. Add the 4 parts, or wait for built-in splitting.`);
        setStatus(`${note}. ${file.name} loaded on Music.`);
      }
      refreshProcessed(deck, sampleRate);
      paintDeck(deck);
      pushDeckAudio(deck);
      updateNostrPreview(deck, true);
    } catch (err) {
      setStatus(`Could not load that file: ${String(err)}`);
    } finally {
      setSplitBadge(deck, false);
    }
  };

  const loadAudioFiles = async (deck: DeckIndex, files: File[], forcedStem: StemIndex | null) => {
    const audio = files.filter(isAudioFile);
    if (audio.length === 0) {
      setStatus("Use a wav, mp3, flac, ogg, m4a, or aiff file.");
      return;
    }
    if (audio.length === 1) {
      const only = audio[0];
      const emptyAround =
        forcedStem === null ||
        ([0, 1, 2, 3] as const).every(
          (stem) => stem === forcedStem || !(controller.decks[deck].stems[stem]?.length),
        );
      if (forcedStem === null || emptyAround) {
        await loadFullSong(deck, only);
        return;
      }
      await loadStemFile(deck, forcedStem, only);
      return;
    }
    const plan = assignStemFiles(audio);
    for (const item of plan) await loadStemFile(deck, item.stem, item.file);
    const count = loadedStemCount(deck);
    if (count < 4) {
      setSplitNote(deck, "This song isn't split yet. Add the 4 parts (Drums, Bass, Vocals, Music) or wait for built-in splitting.");
    } else {
      setSplitNote(deck, null);
      setStatus(`${SONG_LABELS[deck]} has all 4 parts.`);
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

  const armPlayback = async (): Promise<boolean> => {
    try {
      await ensureBridgeInitialized();
      await bridge.resume();
      document.documentElement.dataset.audioState = bridge.audioState;
      document.documentElement.dataset.sampleRate = String(bridge.sampleRate);
      return bridge.isReady;
    } catch (err) {
      setStatus(`Audio engine failed: ${String(err)}`);
      return false;
    }
  };

  const setDeckPlay = async (deck: DeckIndex, playing: boolean) => {
    controller.setDeckPlaying(deck, playing);
    paintDeck(deck);
    updateNostrPreview(deck);
    if (playing) {
      const ready = await armPlayback();
      if (!ready) return;
    }
    if (bridge.isReady) bridge.setDeckPlaying(deck, controller.decks[deck].playing);
  };

  root.querySelectorAll<HTMLButtonElement>(".deck-play").forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      if (deck === null) return;
      void setDeckPlay(deck, !controller.decks[deck].playing);
    });
  });

  root.querySelector<HTMLButtonElement>("#btn-play-all")?.addEventListener("click", () => {
    const any = controller.decks.some((deck) => deck.playing);
    if (any) {
      for (let deck = 0; deck < 4; deck++) {
        if (controller.decks[deck as DeckIndex].playing) void setDeckPlay(deck as DeckIndex, false);
      }
      return;
    }
    const audible = ([0, 1, 2, 3] as const).filter((deck) => stemFrameCount(controller.decks[deck].stems) > 0);
    if (audible.length === 0) {
      setStatus("Add a song first.");
      return;
    }
    for (const deck of audible) void setDeckPlay(deck, true);
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
      const tempo = controller.setDeckTempoPmy(deck, sliderToTempoPmy(Number(input.value)));
      input.value = String(tempoToSlider(tempo));
      input.dataset.tempoPmy = String(tempo);
      input.style.setProperty("--pct", `${(Number(input.value) / PACE_SLIDER_MAX) * 100}%`);
      const readout = root.querySelector<HTMLElement>(`#pace-${deck}`);
      if (readout) readout.textContent = paceLabel(tempo, controller.decks[deck].bpm_cbpm);
      const card = root.querySelector<HTMLElement>(`[data-song-card="${deck}"]`);
      if (card) card.dataset.tempoPmy = String(tempo);
      if (bridge.isReady) {
        bridge.setDeckTempoPmy(deck, tempo);
        bridge.setDeckKeylock(deck, controller.decks[deck].keylock);
      }
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

  const filesFrom = (list: FileList | null | undefined): File[] => (list ? Array.from(list) : []);

  const markHot = (el: HTMLElement, hot: boolean) => {
    el.classList.toggle("is-hot", hot);
    const hint = el.querySelector<HTMLElement>(".drop-hint");
    if (hint) hint.textContent = hot ? "Drop to load" : "Drop to load";
  };

  root.querySelectorAll<HTMLElement>(".stem-drop").forEach((zone) => {
    const deck = asDeck(zone.dataset.deck);
    const stem = asStem(zone.dataset.stem);
    const input = root.querySelector<HTMLInputElement>(
      `.stem-file[data-deck="${zone.dataset.deck}"][data-stem="${zone.dataset.stem}"]`,
    );
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      markHot(zone, true);
    });
    zone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      markHot(zone, true);
    });
    zone.addEventListener("dragleave", () => markHot(zone, false));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      markHot(zone, false);
      if (deck === null) return;
      void loadAudioFiles(deck, filesFrom(event.dataTransfer?.files), stem);
    });
    input?.addEventListener("change", () => {
      if (deck === null || stem === null) return;
      const file = input.files?.[0];
      if (file) void loadStemFile(deck, stem, file);
      input.value = "";
    });
  });

  root.querySelectorAll<HTMLElement>(".song-drop").forEach((zone) => {
    const deck = asDeck(zone.dataset.deck);
    const input = zone.querySelector<HTMLInputElement>("input[type='file']");
    zone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      markHot(zone, true);
    });
    zone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      markHot(zone, true);
    });
    zone.addEventListener("dragleave", () => markHot(zone, false));
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      markHot(zone, false);
      if (deck === null) return;
      void loadAudioFiles(deck, filesFrom(event.dataTransfer?.files), null);
    });
    input?.addEventListener("change", () => {
      if (deck === null) return;
      void loadAudioFiles(deck, filesFrom(input.files), null);
      input.value = "";
    });
  });

  root.querySelectorAll<HTMLButtonElement>('[data-action="choose-song"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = btn.dataset.deck;
      root.querySelector<HTMLInputElement>(`.song-file[data-deck="${deck}"]`)?.click();
    });
  });

  let dragDepth = 0;
  const dragHasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
  window.addEventListener("dragover", (event) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  window.addEventListener("dragenter", (event) => {
    if (!dragHasFiles(event)) return;
    dragDepth += 1;
    document.body.classList.add("is-file-drag");
  });
  window.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove("is-file-drag");
  });
  window.addEventListener("drop", (event) => {
    dragDepth = 0;
    document.body.classList.remove("is-file-drag");
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    const card = event.target instanceof Element ? event.target.closest("[data-song-card]") : null;
    const deck = asDeck(card instanceof HTMLElement ? card.dataset.deck : undefined) ?? 0;
    void loadAudioFiles(deck, filesFrom(event.dataTransfer.files), null);
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
      const fx = controller.fxSlots[slot];
      const next = !fx.enabled;
      const sent = bridge.armFxSlot(slot, fx.preset, fx.intensity_pmy, next);
      controller.setFxIntensityPmy(slot, sent);
      controller.fxSlots[slot].enabled = next;
      btn.setAttribute("aria-pressed", String(next));
      btn.dataset.active = String(next);
      paintFxReadout();
    });
  });

  const perf = { filter: false, echo: false, reverb: false };
  const paintFxReadout = () => {
    const readout = root.querySelector<HTMLElement>("#fx-readout");
    if (!readout) return;
    const on: string[] = [];
    if (perf.filter) on.push("Filter");
    if (perf.echo) on.push("Echo");
    if (perf.reverb) on.push("Reverb");
    readout.hidden = on.length === 0;
    readout.textContent = on.length ? `${on.join(" · ")} on · whole mix` : "";
  };
  const syncPerfButton = (name: string, on: boolean) => {
    const btn = root.querySelector<HTMLButtonElement>(`[data-fx="${name}"]`);
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(on));
    btn.dataset.active = String(on);
  };
  const ensureFx = async (): Promise<boolean> => armPlayback();

  root.querySelector<HTMLButtonElement>('[data-fx="filter"]')?.addEventListener("click", () => {
    void ensureFx().then((ready) => {
      perf.filter = !perf.filter;
      const pmy = perf.filter ? -4_500 : 0;
      for (let deck = 0; deck < 4; deck++) {
        controller.setDeckFilterPmy(deck as DeckIndex, pmy);
        if (ready) bridge.setDeckFilterPmy(deck as DeckIndex, pmy);
        const tone = root.querySelector<HTMLInputElement>(`[data-slider="tone-sweep"][data-deck="${deck}"]`);
        if (tone) tone.value = String(pmy);
        const toneOut = root.querySelector<HTMLElement>(`#tone-${deck}`);
        if (toneOut) toneOut.textContent = String(pmy);
      }
      if (ready) bridge.setPerformanceFilter(perf.filter, pmy);
      syncPerfButton("filter", perf.filter);
      paintFxReadout();
    });
  });
  root.querySelector<HTMLButtonElement>('[data-fx="echo"]')?.addEventListener("click", () => {
    void ensureFx().then((ready) => {
      perf.echo = !perf.echo;
      const sent = bridge.armFxSlot(0, "echo", controller.fxSlots[0].intensity_pmy || 6_500, perf.echo);
      controller.setFxSlot(0, "echo");
      controller.setFxIntensityPmy(0, sent);
      controller.fxSlots[0].enabled = perf.echo;
      const slotBtn = root.querySelector<HTMLButtonElement>('[data-action="fx-slot"][data-slot="0"]');
      slotBtn?.setAttribute("aria-pressed", String(perf.echo));
      if (ready) {
        bridge.setPerformanceEcho(perf.echo, sent, "1/4", controller.decks[0].bpm_cbpm / 100);
      }
      syncPerfButton("echo", perf.echo);
      paintFxReadout();
    });
  });
  root.querySelector<HTMLButtonElement>('[data-fx="reverb"]')?.addEventListener("click", () => {
    void ensureFx().then((ready) => {
      perf.reverb = !perf.reverb;
      const sent = bridge.armFxSlot(1, "far-away", controller.fxSlots[1].intensity_pmy || 6_500, perf.reverb);
      controller.setFxSlot(1, "far-away");
      controller.setFxIntensityPmy(1, sent);
      controller.fxSlots[1].enabled = perf.reverb;
      const slotBtn = root.querySelector<HTMLButtonElement>('[data-action="fx-slot"][data-slot="1"]');
      slotBtn?.setAttribute("aria-pressed", String(perf.reverb));
      if (ready) bridge.setPerformanceReverb(perf.reverb, sent);
      syncPerfButton("reverb", perf.reverb);
      paintFxReadout();
    });
  });
  const buildup = root.querySelector<HTMLButtonElement>('[data-fx="buildup"]');
  const releaseBuild = () => {
    bridge.releaseBuildup();
    buildup?.setAttribute("aria-pressed", "false");
  };
  buildup?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    void ensureFx().then((ready) => {
      if (!ready) return;
      bridge.holdBuildup();
      for (let deck = 0; deck < 4; deck++) {
        controller.setDeckFilterPmy(deck as DeckIndex, -7_000);
        bridge.setDeckFilterPmy(deck as DeckIndex, -7_000);
      }
      buildup.setAttribute("aria-pressed", "true");
    });
  });
  buildup?.addEventListener("pointerup", releaseBuild);
  buildup?.addEventListener("pointercancel", releaseBuild);
  buildup?.addEventListener("pointerleave", releaseBuild);

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
      if (bridge.isReady) {
        bridge.setDeckKeylock(deck, on);
        bridge.setDeckTempoPmy(deck, controller.decks[deck].tempo_pmy);
      }
    });
  });

  const pushLoop = (deck: DeckIndex, start: number, end: number) => {
    controller.setDeckLoop(deck, true, start, end);
    if (bridge.isReady) bridge.setDeckLoop(deck, true, start, end);
    paintLoop(deck);
    paintPlayhead(deck);
  };

  root.querySelectorAll<HTMLButtonElement>('[data-action="repeat-toggle"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const deck = asDeck(btn.dataset.deck);
      if (deck === null) return;
      const state = controller.decks[deck];
      if (state.loop.enabled) {
        controller.setDeckLoop(deck, false, state.loop.start_frame, state.loop.end_frame);
        if (bridge.isReady) bridge.setDeckLoop(deck, false, state.loop.start_frame, state.loop.end_frame);
        paintLoop(deck);
        paintPlayhead(deck);
        return;
      }
      if (stemFrameCount(state.stems) === 0) {
        setStatus("Load a song before setting a repeat section.");
        return;
      }
      const start = state.pos_frames >>> 0;
      const length = oneBarFrames(state.bpm_cbpm, bridge.sampleRate);
      pushLoop(deck, start, start + length);
    });
  });

  const resizeRepeat = (btn: HTMLButtonElement, direction: -1 | 1) => {
    const deck = asDeck(btn.dataset.deck);
    if (deck === null) return;
    const state = controller.decks[deck];
    const current = state.loop.end_frame - state.loop.start_frame;
    const start = current > 0 ? state.loop.start_frame : state.pos_frames >>> 0;
    const length = nextLoopLength(current, direction, stemFrameCount(state.stems), state.bpm_cbpm, bridge.sampleRate);
    pushLoop(deck, start, start + length);
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
      const pos = controller.decks[deck].pos_frames >>> 0;
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
    bridge.onTelemetry((rms, spectrum, positions) => {
      for (let deck = 0; deck < 4; deck++) {
        controller.decks[deck as DeckIndex].pos_frames = positions[deck] ?? 0;
        paintPlayhead(deck as DeckIndex);
      }
      fitCanvas();
      skyMeters.rms = rms;
      const top = spectrum.slice(Math.max(0, spectrum.length - 16));
      skyMeters.high = top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
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
  } else {
    bridge.onTelemetry((_rms, _spectrum, positions) => {
      for (let deck = 0; deck < 4; deck++) {
        controller.decks[deck as DeckIndex].pos_frames = positions[deck] ?? 0;
        paintPlayhead(deck as DeckIndex);
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== " ") return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target instanceof HTMLInputElement && (target.type === "text" || target.type === "number")) return;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
    event.preventDefault();
    if (target instanceof HTMLInputElement && target.type === "range") {
      const deck = asDeck(target.dataset.deck);
      if (deck !== null) void setDeckPlay(deck, !controller.decks[deck].playing);
      return;
    }
    const card = target.closest("[data-song-card]");
    if (card instanceof HTMLElement) {
      const deck = asDeck(card.dataset.deck);
      if (deck !== null) void setDeckPlay(deck, !controller.decks[deck].playing);
      return;
    }
    root.querySelector<HTMLButtonElement>("#btn-play-all")?.click();
  });

  const captureHost = window as unknown as { __forgeCapture?: () => ReturnType<RemixAudioBridge["captureMix"]> };
  captureHost.__forgeCapture = () => bridge.captureMix();

  for (let deck = 0; deck < 4; deck++) paintDeck(deck as DeckIndex);
  paintCrossfader();

  return { controller, bridge };
}
