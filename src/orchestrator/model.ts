export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface ModelRequest {
  /** What the call is for. The small jobs (extract, and the eval harness's setup and judge) run on a cheaper model. */
  purpose: "extract" | "reply" | "rewrite" | "script" | "critic" | "setup" | "judge";
  system: string; messages: ChatMessage[];
  /** The start of `system` that is the same on every call of this kind; the API client caches it so repeat calls cost less. */
  cachePrefix?: string;
}
/** The language model behind the coach. A real client (Anthropic API) is added in milestone 5; tests use a scripted fake. */
export interface ChatModel { complete(req: ModelRequest): Promise<string> }
