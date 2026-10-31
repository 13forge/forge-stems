import type { FxSlotIndex } from "./types.js";

/** Engine slots open silent unless a preset and a non-zero wet amount are sent before the toggle. */
export const FX_DEFAULT_INTENSITY_PMY = 6_500;

export type FxArmMessage =
  | { type: "SET_FX_SLOT"; slot: FxSlotIndex; preset: string }
  | { type: "SET_FX_INTENSITY_PMY"; slot: FxSlotIndex; intensity_pmy: number }
  | { type: "TOGGLE_FX_SLOT"; slot: FxSlotIndex };

/**
 * Absolute arm/disarm plan. Intensity is permyriad 1..10000 (0 is replaced so the slot is not a dry kill).
 * Toggle is last and only when the engine's on/off bit must flip. `toggle_fx_slot` is relative.
 */
export function planFxArm(args: {
  slot: FxSlotIndex;
  preset: string;
  intensity_pmy: number;
  engineOn: boolean;
  nextOn: boolean;
}): FxArmMessage[] {
  const intensity =
    Number.isFinite(args.intensity_pmy) && args.intensity_pmy > 0
      ? Math.round(args.intensity_pmy)
      : FX_DEFAULT_INTENSITY_PMY;
  const plan: FxArmMessage[] = [
    { type: "SET_FX_SLOT", slot: args.slot, preset: args.preset },
    { type: "SET_FX_INTENSITY_PMY", slot: args.slot, intensity_pmy: intensity },
  ];
  if (args.engineOn !== args.nextOn) {
    plan.push({ type: "TOGGLE_FX_SLOT", slot: args.slot });
  }
  return plan;
}
