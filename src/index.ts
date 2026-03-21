// convo-compress - Incremental sliding-window chat compressor with rolling summaries

export { createCompressor } from './compressor.js';
export { defaultSummarizationPrompt, defaultMergePrompt } from './prompts.js';
export { defaultTokenCounter, countMessageTokens } from './token-counter.js';

export type {
  Message,
  ToolCall,
  SummarizerFn,
  SummarizerContext,
  TokenCounter,
  MergeStrategy,
  CustomMergeFn,
  EvictionConfig,
  CompressedConversation,
  CompressionStats,
  CompressorOptions,
  ConvoCompressor,
  CompressorState,
} from './types.js';

import { createCompressor } from './compressor.js';
import type { CompressorState, CompressorOptions, ConvoCompressor } from './types.js';

/**
 * Restore a ConvoCompressor from a serialized state snapshot.
 * Pass the same summarizer (and optional tokenCounter/customMerge/hooks) used
 * when the compressor was originally created.
 */
export function deserialize(
  state: CompressorState,
  fns: Pick<CompressorOptions, 'summarizer' | 'tokenCounter' | 'customMerge' | 'hooks'>
): ConvoCompressor {
  return createCompressor(
    {
      summarizer: fns.summarizer,
      tokenCounter: fns.tokenCounter,
      customMerge: fns.customMerge,
      hooks: fns.hooks,
      eviction: state.options.eviction,
      mergeStrategy: state.options.mergeStrategy,
      maxSummaryTokens: state.options.maxSummaryTokens,
      messageOverhead: state.options.messageOverhead,
      summaryRole: state.options.summaryRole,
    },
    {
      summary: state.summary,
      recentMessages: state.recentMessages,
      stats: state.stats,
    }
  );
}
