export type Tag = "computed";
export type Confidence = "low" | "medium" | "high";
export type CheckStatus = "ok" | "flag" | "error";
export interface Check { id: string; status: CheckStatus; detail: string }
export const roundTo = (x: number, unit: number): number => Math.round(x / unit) * unit;
