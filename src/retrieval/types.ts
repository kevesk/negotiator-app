export type Agent = "coach" | "researcher" | "simulator" | "scorer" | "writer" | "critic";
export type Stage = "route" | "intake" | "position" | "market" | "numbers" | "strategy" | "scripts" | "brief" | "practice" | "debrief";

export interface NoteMeta {
  name: string; title: string; folder: string; type: string | null; status: string | null;
  audience: Agent[]; cite: "ok" | "never"; aliases: string[]; tags: string[]; paths: ("A" | "B")[]; stages: Stage[];
  modifiers: string[]; lang: "en" | "sv" | "en-sv"; valid_as_of: string | null; verify_before_use: boolean;
  confidence: string | null; related: string[];
}
export interface Chunk { id: string; note: string; heading: string; text: string }
export interface VaultIndex { built_on: string; notes: NoteMeta[]; chunks: Chunk[] }

export interface RetrievalState {
  agent: Agent; path: "A" | "B"; stage: Stage; modifiers?: string[];
  /** development: draft notes allowed; release: only reviewed and final */
  allowDraft?: boolean;
  /** today's date, to flag facts older than the current income year */
  today?: string;
}
export interface RetrievalOptions { maxChunks?: number; charBudget?: number; linkSlots?: number; semantic?: SemanticScorer }
/** Optional semantic scorer: returns a 0..1 similarity per chunk id. Combined with keyword scores. */
export type SemanticScorer = (query: string, chunkIds: string[]) => Map<string, number>;

export interface Retrieved {
  note: string; title: string; heading: string; text: string; score: number;
  via: "search" | "link" | "fallback"; cite: "ok" | "never";
  flags: { verify_before_use: boolean; outdated: boolean; confidence: string | null; valid_as_of: string | null };
}
export interface RetrievalResult { items: Retrieved[]; fallback: boolean; chars: number }
