import type {
  CompressorOptions,
  ConvoCompressor,
  CompressorState,
  CompressedConversation,
  CompressionStats,
  EvictionConfig,
  MergeStrategy,
  Message,
} from './types.js';
import { defaultTokenCounter, countMessageTokens } from './token-counter.js';
import { defaultSummarizationPrompt } from './prompts.js';
import { shouldEvict, getEvictionCount, getAtomicEvictionGroup } from './eviction.js';
import { mergeSummaries } from './merge.js';

interface RestoreState {
  summary: string | null;
  recentMessages: Message[];
  stats: CompressionStats;
}

export function createCompressor(options: CompressorOptions, restore?: RestoreState): ConvoCompressor {
  let summary: string | null = restore?.summary ?? null;
  let recentMessages: Message[] = restore ? [...restore.recentMessages] : [];

  const eviction: EvictionConfig = options.eviction ?? { trigger: 'messages', threshold: 20, target: 12 };
  const mergeStrategy: MergeStrategy = options.mergeStrategy ?? 'summarize';
  const counter = options.tokenCounter ?? defaultTokenCounter;
  const overhead = options.messageOverhead ?? 4;
  const maxSummaryTokens = options.maxSummaryTokens ?? 2000;
  const summaryRole: 'system' | 'user' = options.summaryRole ?? 'system';

  const stats: CompressionStats = restore
    ? { ...restore.stats }
    : {
        totalMessages: 0,
        messagesCompressed: 0,
        messagesInWindow: 0,
        totalInputTokens: 0,
        summaryTokens: 0,
        windowTokens: 0,
        compressionRatio: 0,
        summarizationCalls: 0,
      };

  function computeWindowTokens(): number {
    return recentMessages.reduce((sum, m) => sum + countMessageTokens(m, counter, overhead), 0);
  }

  function updateDerivedStats(): void {
    stats.messagesInWindow = recentMessages.length;
    stats.windowTokens = computeWindowTokens();
    stats.summaryTokens = summary ? counter(summary) : 0;
    stats.compressionRatio =
      stats.messagesCompressed / Math.max(1, stats.totalMessages);
  }

  function addMessage(message: Message): void {
    recentMessages.push(message);
    stats.totalMessages++;
    stats.totalInputTokens += countMessageTokens(message, counter, overhead);
  }

  function addMessages(messages: Message[]): void {
    for (const m of messages) {
      addMessage(m);
    }
  }

  async function compress(compressOptions?: { evictCount?: number }): Promise<void> {
    let evictCount: number;

    if (compressOptions?.evictCount !== undefined) {
      evictCount = compressOptions.evictCount;
    } else {
      evictCount = getEvictionCount(recentMessages, summary, eviction, counter, overhead);
    }

    if (evictCount <= 0 || recentMessages.length === 0) return;

    // Collect messages to evict, respecting atomic groups
    let evictIdx = 0;
    let collected = 0;

    while (collected < evictCount && evictIdx < recentMessages.length) {
      const groupEnd = getAtomicEvictionGroup(recentMessages, evictIdx);
      const groupSize = groupEnd - evictIdx + 1;
      // Don't break an atomic group partway through — only skip if we already have some
      if (collected > 0 && collected + groupSize > evictCount && groupSize > 1) {
        break;
      }
      evictIdx = groupEnd + 1;
      collected += groupSize;
    }

    evictIdx = Math.min(evictIdx, recentMessages.length);

    if (evictIdx === 0) return;

    const toEvict = recentMessages.slice(0, evictIdx);
    recentMessages = recentMessages.slice(evictIdx);

    const startMs = Date.now();

    let newSummary: string;
    try {
      newSummary = await options.summarizer(toEvict, {
        existingSummary: summary,
        defaultPrompt: defaultSummarizationPrompt,
        targetTokens: maxSummaryTokens,
      });
      stats.summarizationCalls++;
    } catch (err) {
      // Restore evicted messages on error
      recentMessages = [...toEvict, ...recentMessages];
      if (options.hooks?.onError) {
        options.hooks.onError(err instanceof Error ? err : new Error(String(err)), toEvict);
      }
      throw err;
    }

    summary = await mergeSummaries(summary, newSummary, mergeStrategy, {
      summarizer: options.summarizer,
      customMerge: options.customMerge,
    });

    stats.messagesCompressed += toEvict.length;
    stats.summaryTokens = counter(summary);

    const elapsed = Date.now() - startMs;

    if (options.hooks?.onEvict) {
      options.hooks.onEvict(toEvict, eviction.trigger);
    }
    if (options.hooks?.onCompress) {
      options.hooks.onCompress(toEvict, summary, elapsed);
    }

    updateDerivedStats();
  }

  async function getCompressed(): Promise<CompressedConversation> {
    if (shouldEvict(recentMessages, summary, eviction, counter, overhead)) {
      await compress();
    }
    updateDerivedStats();
    return { summary, recentMessages: [...recentMessages] };
  }

  async function getMessages(): Promise<Message[]> {
    const compressed = await getCompressed();
    const result: Message[] = [];
    if (compressed.summary) {
      result.push({ role: summaryRole, content: compressed.summary });
    }
    result.push(...compressed.recentMessages);
    return result;
  }

  function getSummary(): string | null {
    return summary;
  }

  function getStats(): CompressionStats {
    updateDerivedStats();
    return { ...stats };
  }

  function resetStats(): void {
    stats.totalMessages = 0;
    stats.messagesCompressed = 0;
    stats.messagesInWindow = 0;
    stats.totalInputTokens = 0;
    stats.summaryTokens = 0;
    stats.windowTokens = 0;
    stats.compressionRatio = 0;
    stats.summarizationCalls = 0;
  }

  function serialize(): CompressorState {
    updateDerivedStats();
    return {
      summary,
      recentMessages: [...recentMessages],
      stats: { ...stats },
      version: 1,
      options: {
        eviction,
        mergeStrategy,
        maxSummaryTokens,
        messageOverhead: overhead,
        summaryRole,
      },
    };
  }

  function clear(): void {
    summary = null;
    recentMessages = [];
    resetStats();
  }

  return {
    addMessage,
    addMessages,
    getCompressed,
    getMessages,
    getSummary,
    compress,
    getStats,
    resetStats,
    serialize,
    clear,
  };
}
