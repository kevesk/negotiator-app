export interface ChatMessage { role: "user" | "assistant"; content: string }
export interface ModelRequest { purpose: "extract" | "reply" | "rewrite"; system: string; messages: ChatMessage[] }
/** The language model behind the coach. A real client (Anthropic API) is added in milestone 5; tests use a scripted fake. */
export interface ChatModel { complete(req: ModelRequest): Promise<string> }
