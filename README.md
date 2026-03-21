# convo-compress

Incremental sliding-window chat compressor with rolling summaries. Each message is summarized at most once — O(n) total cost, not O(n²).

## Install

```bash
npm install convo-compress
```

Zero runtime dependencies.

## Quick Start

```typescript
import { createCompressor } from 'convo-compress';

// Provide your own summarizer — any LLM call that returns a string
async function mySummarizer(messages, context) {
  // Call OpenAI, Anthropic, etc.
  return 'Summary of conversation...';
}

const compressor = createCompressor({
  summarizer: mySummarizer,
  eviction: { trigger: 'messages', threshold: 20, target: 12 },
  mergeStrategy: 'summarize',
});

// Add messages as the conversation grows
compressor.addMessage({ role: 'user', content: 'Hello!' });
compressor.addMessage({ role: 'assistant', content: 'Hi there!' });

// Get compressed form — auto-evicts if threshold exceeded
const { summary, recentMessages } = await compressor.getCompressed();

// Get ready-to-send message array (summary prepended as system message)
const messages = await compressor.getMessages();
```

## Eviction Config

Control when messages are evicted from the recent window:

```typescript
// Evict when > 20 messages; target 12 after eviction
{ trigger: 'messages', threshold: 20, target: 12 }

// Evict when > 4000 tokens in window; target 2000
{ trigger: 'tokens', threshold: 4000, target: 2000 }

// Evict when either limit exceeded
{
  trigger: 'combined',
  messageThreshold: 20, messageTarget: 12,
  tokenThreshold: 4000, tokenTarget: 2000,
}

// Never auto-evict — call compress() manually
{ trigger: 'manual' }
```

## Merge Strategies

When evicted messages are summarized, the new summary is merged with the existing anchor:

| Strategy | Behavior |
|---|---|
| `summarize` | LLM merges both summaries into one (default) |
| `append` | Concatenate old + new with `\n\n` |
| `replace` | New summary replaces old entirely |
| `weighted` | LLM merges with emphasis on recent content |
| `custom` | Your own merge function |

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  mergeStrategy: 'append',
});

// Or custom:
const compressor = createCompressor({
  summarizer: mySummarizer,
  mergeStrategy: 'custom',
  customMerge: async (oldSummary, newSummary) => `${oldSummary}\n---\n${newSummary}`,
});
```

## Persistence (serialize / deserialize)

```typescript
import { deserialize } from 'convo-compress';

// Save
const state = compressor.serialize(); // plain JSON-serializable object
await db.save('conv:123', JSON.stringify(state));

// Restore
const raw = JSON.parse(await db.load('conv:123'));
const restored = deserialize(raw, { summarizer: mySummarizer });
```

## Manual Compression

```typescript
// Force compress a specific number of messages
await compressor.compress({ evictCount: 5 });
```

Tool call messages are evicted atomically — an assistant message with `tool_calls` and its subsequent `tool` result messages always move together.

## Stats

```typescript
const stats = compressor.getStats();
// {
//   totalMessages, messagesCompressed, messagesInWindow,
//   totalInputTokens, summaryTokens, windowTokens,
//   compressionRatio, summarizationCalls
// }
```

## Hooks

```typescript
createCompressor({
  summarizer: mySummarizer,
  hooks: {
    onEvict: (msgs, reason) => console.log(`Evicting ${msgs.length} messages (${reason})`),
    onCompress: (msgs, summary, ms) => console.log(`Compressed in ${ms}ms`),
    onError: (err, msgs) => console.error('Compression failed:', err),
  },
});
```

## Token Counter

By default uses `Math.ceil(text.length / 4)`. Pass your own for accuracy:

```typescript
import { createCompressor } from 'convo-compress';
import { encoding_for_model } from 'tiktoken';

const enc = encoding_for_model('gpt-4o');

createCompressor({
  summarizer: mySummarizer,
  tokenCounter: (text) => enc.encode(text).length,
});
```

## API

### `createCompressor(options): ConvoCompressor`

| Option | Type | Default | Description |
|---|---|---|---|
| `summarizer` | `SummarizerFn` | required | Async function that summarizes messages |
| `eviction` | `EvictionConfig` | `messages threshold:20 target:12` | When to evict |
| `mergeStrategy` | `MergeStrategy` | `'summarize'` | How to merge summaries |
| `customMerge` | `CustomMergeFn` | — | Required when `mergeStrategy='custom'` |
| `maxSummaryTokens` | `number` | `2000` | Token budget hint passed to summarizer |
| `tokenCounter` | `TokenCounter` | `ceil(len/4)` | Custom token counter |
| `messageOverhead` | `number` | `4` | Tokens added per message for framing |
| `summaryRole` | `'system'\|'user'` | `'system'` | Role of the injected summary message |
| `hooks` | object | — | `onEvict`, `onCompress`, `onError` callbacks |

### `deserialize(state, fns): ConvoCompressor`

Restore a compressor from a `CompressorState` snapshot. Pass the same `summarizer` (and optionally `tokenCounter`, `customMerge`, `hooks`) used when the state was created.

## License

MIT
