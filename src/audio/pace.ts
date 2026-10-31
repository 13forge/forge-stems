import { clampTempoPmy, TEMPO_MAX_PMY, TEMPO_MIN_PMY, TEMPO_UNITY_PMY } from "./types.js";

/**
 * Pace slider is 0..1000 so 1.0× sits in the middle.
 * 0 = half speed (5000), 500 = unity (10000), 1000 = double (20000).
 * Moving the thumb right always raises `set_deck_tempo_pmy`.
 */
export const PACE_SLIDER_MIN = 0;
export const PACE_SLIDER_UNITY = 500;
export const PACE_SLIDER_MAX = 1_000;

export function sliderToTempoPmy(slider: number): number {
  const t = Number.isFinite(slider) ? Math.max(PACE_SLIDER_MIN, Math.min(PACE_SLIDER_MAX, slider)) : PACE_SLIDER_UNITY;
  if (t <= PACE_SLIDER_UNITY) {
    return clampTempoPmy(TEMPO_MIN_PMY + (t / PACE_SLIDER_UNITY) * (TEMPO_UNITY_PMY - TEMPO_MIN_PMY));
  }
  const rise = (t - PACE_SLIDER_UNITY) / (PACE_SLIDER_MAX - PACE_SLIDER_UNITY);
  return clampTempoPmy(TEMPO_UNITY_PMY + rise * (TEMPO_MAX_PMY - TEMPO_UNITY_PMY));
}

export function tempoToSlider(tempoPmy: number): number {
  const p = clampTempoPmy(tempoPmy);
  if (p <= TEMPO_UNITY_PMY) {
    return Math.round(((p - TEMPO_MIN_PMY) / (TEMPO_UNITY_PMY - TEMPO_MIN_PMY)) * PACE_SLIDER_UNITY);
  }
  return Math.round(
    PACE_SLIDER_UNITY +
      ((p - TEMPO_UNITY_PMY) / (TEMPO_MAX_PMY - TEMPO_UNITY_PMY)) * (PACE_SLIDER_MAX - PACE_SLIDER_UNITY),
  );
}

/** Readout shares the thumb value. Left is slower, right is faster. Base grid is 120 BPM at unity. */
export function paceLabel(tempoPmy: number, baseCbpm = 12_000): string {
  const tempo = clampTempoPmy(tempoPmy);
  const rate = tempo / TEMPO_UNITY_PMY;
  const bpm = (baseCbpm / 100) * rate;
  return `${rate.toFixed(2)}× · ${bpm.toFixed(0)} BPM`;
}
