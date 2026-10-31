// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { mountRemixShell } from "../src/ui/app.js";
import type { RemixController } from "../src/state/controller.js";
import skyWgsl from "../src/ui/shaders/launcher_sky.wgsl?raw";

function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`missing element: ${selector}`);
  return el;
}

function click(root: ParentNode, selector: string): void {
  q<HTMLElement>(root, selector).dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

let root: HTMLElement;
let controller: RemixController;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  root = document.getElementById("app") as HTMLElement;
  controller = mountRemixShell(root).controller;
});

describe("ui ergonomics: layout and defaults", () => {
  it("renders four macro zones and shows only Song 1 and Song 2", () => {
    expect(root.querySelectorAll("[data-zone]")).toHaveLength(4);
    expect(q<HTMLElement>(root, '[data-song-card="0"]').hidden).toBe(false);
    expect(q<HTMLElement>(root, '[data-song-card="1"]').hidden).toBe(false);
    expect(q<HTMLElement>(root, '[data-song-card="2"]').hidden).toBe(true);
    expect(q<HTMLElement>(root, '[data-song-card="3"]').hidden).toBe(true);
    click(root, '[data-action="toggle-4-songs"]');
    expect(q<HTMLElement>(root, '[data-song-card="2"]').hidden).toBe(false);
    expect(q<HTMLElement>(root, '[data-song-card="3"]').hidden).toBe(false);
  });

  it("keeps every Tier 2 drawer collapsed until toggled", () => {
    expect(q<HTMLElement>(root, '[data-tier2="song-pro"][data-deck="0"]').hidden).toBe(true);
    expect(q<HTMLElement>(root, '[data-tier2="fx-body"]').hidden).toBe(true);
    click(root, '[data-action="toggle-pro"][data-deck="0"]');
    expect(q<HTMLElement>(root, '[data-tier2="song-pro"][data-deck="0"]').hidden).toBe(false);
  });

  it("uses plain-language labels and no raw engine jargon", () => {
    const text = root.textContent ?? "";
    for (const label of ["Song 1", "Song 2", "Drums", "Bass", "Voice", "Music", "Blend", "Only This"]) {
      expect(text).toContain(label);
    }
    expect(text).not.toContain("Crossfader (pmy)");
    expect(text).not.toContain("Bipolar SVF");
  });
});

describe("moonforge sky: background canvas", () => {
  it("degrades to no canvas when navigator.gpu is absent", async () => {
    expect((navigator as unknown as { gpu?: unknown }).gpu).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('canvas[data-moonforge-sky="true"]')).toBeNull();
    expect(root.style.zIndex).toBe("");
    expect(root.querySelectorAll("[data-zone]")).toHaveLength(4);
  });

  it("ships the launcher_sky moon with its mask restored", () => {
    expect(skyWgsl).toContain("let moon_mask = 1.0 - smoothstep(");
    expect(skyWgsl).not.toContain("0.0 * (1.0 - smoothstep");
  });
});

describe("ui ergonomics: solo dimming and resets", () => {
  it("dims every strip except the soloed one (Only This, bit 1 << stem)", () => {
    click(root, '[data-action="stem-solo"][data-deck="0"][data-stem="1"]');
    expect(q<HTMLElement>(root, '[data-stem-strip="1"][data-deck="0"]').dataset.dimmed).toBe("false");
    expect(q<HTMLElement>(root, '[data-stem-strip="0"][data-deck="0"]').dataset.dimmed).toBe("true");
    expect(q<HTMLElement>(root, '[data-stem-strip="2"][data-deck="0"]').dataset.dimmed).toBe("true");
    expect(q<HTMLElement>(root, '[data-stem-strip="3"][data-deck="0"]').dataset.dimmed).toBe("true");
  });

  it("double-click resets the blend slider to 5000", () => {
    const blend = q<HTMLInputElement>(root, '[data-slider="blend"]');
    blend.value = "8000";
    blend.dispatchEvent(new Event("input"));
    expect(controller.crossfader_pmy).toBe(8000);
    blend.dispatchEvent(new Event("dblclick"));
    expect(blend.value).toBe("5000");
    expect(controller.crossfader_pmy).toBe(5000);
  });

  it("double-click resets tone sweep to 0 on deck 0", () => {
    const tone = q<HTMLInputElement>(root, '[data-slider="tone-sweep"][data-deck="0"]');
    tone.value = "4000";
    tone.dispatchEvent(new Event("input"));
    expect(controller.decks[0].filter_pmy).toBe(4000);
    tone.dispatchEvent(new Event("dblclick"));
    expect(controller.decks[0].filter_pmy).toBe(0);
  });
});

describe("ui ergonomics: high-ceiling controls dispatch to RemixController", () => {
  it("bookmarks save on empty, jump when saved, and clear with ×", () => {
    click(root, '[data-action="bookmark"][data-deck="0"][data-slot="2"]');
    expect(controller.decks[0].hotcues[2]).toBe(0);
    expect(q<HTMLElement>(root, '[data-action="bookmark"][data-deck="0"][data-slot="2"]').textContent).toBe("Jump 3");
    click(root, '[data-action="bookmark-clear"][data-deck="0"][data-slot="2"]');
    expect(controller.decks[0].hotcues[2]).toBeNull();
  });

  it("repeat toggle opens a section and ½x / 2x resize it", () => {
    controller.setDeckLoop(1, true, 0, 4096);
    click(root, '[data-action="repeat-half"][data-deck="1"]');
    expect(controller.decks[1].loop.end_frame).toBe(2048);
    click(root, '[data-action="repeat-double"][data-deck="1"]');
    expect(controller.decks[1].loop.end_frame).toBe(4096);
  });

  it("repeat toggle without a loaded song does not enable a loop", () => {
    click(root, '[data-action="repeat-toggle"][data-deck="2"]');
    expect(controller.decks[2].loop.enabled).toBe(false);
  });

  it("Keep Original Pitch toggles keylock", () => {
    click(root, '[data-action="keylock"][data-deck="0"]');
    expect(controller.decks[0].keylock).toBe(true);
  });

  it("Lock to Beat toggles beat snap", () => {
    click(root, '[data-action="beat-lock"][data-deck="0"]');
    expect(controller.decks[0].beat_snap).toBe(true);
  });

  it("Blend Style switches the crossfader curve", () => {
    const select = q<HTMLSelectElement>(root, "#blend-style");
    select.value = "sharp";
    select.dispatchEvent(new Event("change"));
    expect(controller.crossfaderCurve).toBe("sharp");
  });

  it("Effect Strength sets intensity on every FX slot", () => {
    const strength = q<HTMLInputElement>(root, '[data-slider="fx-strength"]');
    strength.value = "6000";
    strength.dispatchEvent(new Event("input"));
    for (const slot of controller.fxSlots) expect(slot.intensity_pmy).toBe(6000);
    strength.dispatchEvent(new Event("dblclick"));
    for (const slot of controller.fxSlots) expect(slot.intensity_pmy).toBe(0);
  });

  it("FX preset selector sets the slot preset", () => {
    const select = q<HTMLSelectElement>(root, '[data-action="fx-preset"][data-slot="1"]');
    select.value = "warm";
    select.dispatchEvent(new Event("change"));
    expect(controller.fxSlots[1].preset).toBe("warm");
  });

  it("FX slot toggle flips enabled state", () => {
    click(root, '[data-action="fx-slot"][data-slot="0"]');
    expect(controller.fxSlots[0].enabled).toBe(true);
  });
});
