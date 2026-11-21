import { roundTo } from "./types";
export type AnchorId = "hold" | "halfway" | "at_p75" | "own";
export interface AnchorOption { id: AnchorId; amount: number; assumed: boolean; flags: string[] }
export interface AnchorInput { target: number; p75?: number; own?: number }
const DISPLAY_UNIT = 500;
/** Anchor options (D70). Never below the target. Rounded to 500 SEK except hold and own. */
export function anchorOptions({ target, p75, own }: AnchorInput): AnchorOption[] {
  const opts: AnchorOption[] = [{ id: "hold", amount: target, assumed: false, flags: [] }];
  if (p75 !== undefined && p75 > target) {
    const half = Math.max(target, roundTo((target + p75) / 2, DISPLAY_UNIT));
    opts.push({ id: "halfway", amount: half, assumed: true, flags: [] });
    opts.push({ id: "at_p75", amount: p75, assumed: false, flags: [] });
  }
  if (own !== undefined) {
    const flags: string[] = [];
    if (own < target) throw new Error("anchor_below_target");
    if (p75 !== undefined && own > p75) flags.push("anchor_above_p75");
    opts.push({ id: "own", amount: own, assumed: false, flags });
  }
  return opts;
}
