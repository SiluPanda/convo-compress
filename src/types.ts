export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type SummarizerFn = (messages: Message[], context?: SummarizerContext) => Promise<string>;

export interface SummarizerContext {
  existingSummary: string | null;
  defaultPrompt: string;
  targetTokens?: number;
}

export type TokenCounter = (text: string) => number;

export type MergeStrategy = 'summarize' | 'append' | 'replace' | 'weighted' | 'custom';

export type CustomMergeFn = (oldSummary: string | null, newSummary: string) => Promise<string>;

export type EvictionConfig =
  | { trigger: 'tokens'; threshold: number; target: number }
  | { trigger: 'messages'; threshold: number; target: number }
  | { trigger: 'combined'; tokenThreshold: number; tokenTarget: number; messageThreshold: number; messageTarget: number }
  | { trigger: 'manual' };

export interface CompressedConversation {
  summary: string | null;
  recentMessages: Message[];
}

export interface CompressionStats {
  totalMessages: number;
  messagesCompressed: number;
  messagesInWindow: number;
  totalInputTokens: number;
  summaryTokens: number;
  windowTokens: number;
  compressionRatio: number;
  summarizationCalls: number;
}

export interface CompressorOptions {
  summarizer: SummarizerFn;
  eviction?: EvictionConfig;
  mergeStrategy?: MergeStrategy;
  customMerge?: CustomMergeFn;
  maxSummaryTokens?: number;
  tokenCounter?: TokenCounter;
  messageOverhead?: number;
  summaryRole?: 'system' | 'user';
  hooks?: {
    onEvict?: (msgs: Message[], reason: string) => void;
    onCompress?: (msgs: Message[], summary: string, ms: number) => void;
    onError?: (err: Error, msgs: Message[]) => void;
  };
}

export interface ConvoCompressor {
  addMessage(message: Message): void;
  addMessages(messages: Message[]): void;
  getCompressed(): Promise<CompressedConversation>;
  getMessages(): Promise<Message[]>;
  getSummary(): string | null;
  compress(options?: { evictCount?: number }): Promise<void>;
  getStats(): CompressionStats;
  resetStats(): void;
  serialize(): CompressorState;
  clear(): void;
}

export interface CompressorState {
  summary: string | null;
  recentMessages: Message[];
  stats: CompressionStats;
  version: 1;
  options: {
    eviction: EvictionConfig;
    mergeStrategy: MergeStrategy;
    maxSummaryTokens: number;
    messageOverhead: number;
    summaryRole: 'system' | 'user';
  };
}
