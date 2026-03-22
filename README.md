# convo-compress

Incremental sliding-window chat compressor with rolling summaries.

[![npm version](https://img.shields.io/npm/v/convo-compress.svg)](https://www.npmjs.com/package/convo-compress)
[![license](https://img.shields.io/npm/l/convo-compress.svg)](https://github.com/SiluPanda/convo-compress/blob/master/LICENSE)
[![node](https://img.shields.io/node/v/convo-compress.svg)](https://www.npmjs.com/package/convo-compress)

## Description

`convo-compress` is a focused compression engine for LLM conversation histories. It implements the "anchored summary + incremental merge" pattern: a running summary captures everything before the recent window, and when new messages age out of the window, only those new messages are summarized and merged with the existing anchor -- never re-processed from scratch. Each message is summarized at most once, giving O(n) total cost instead of the O(n^2) cost of naive approaches that re-summarize the entire conversation prefix on every eviction.

The package is provider-agnostic. You supply a summarizer function that calls whatever LLM you use (OpenAI, Anthropic, local models, etc.), and `convo-compress` orchestrates when and what to summarize, how to merge the result, and when to evict messages from the recent window.

Zero runtime dependencies. TypeScript-first with full type exports.

## Installation

```bash
npm install convo-compress
```

Requires Node.js >= 18.

## Quick Start

```typescript
import { createCompressor } from 'convo-compress';
import type { SummarizerFn } from 'convo-compress';

// Provide your own summarizer -- any async function that returns a string
const mySummarizer: SummarizerFn = async (messages, context) => {
  // Call OpenAI, Anthropic, or any LLM
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: context?.defaultPrompt ?? 'Summarize this conversation.' },
      ...messages,
    ],
  });
  return response.choices[0].message.content;
};

const compressor = createCompressor({
  summarizer: mySummarizer,
  eviction: { trigger: 'messages', threshold: 20, target: 12 },
  mergeStrategy: 'summarize',
});

// Add messages as the conversation grows
compressor.addMessage({ role: 'user', content: 'Hello!' });
compressor.addMessage({ role: 'assistant', content: 'Hi there! How can I help?' });

// Get compressed form -- auto-evicts when threshold is exceeded
const { summary, recentMessages } = await compressor.getCompressed();

// Get a ready-to-send message array (summary prepended as a system message)
const messages = await compressor.getMessages();
```

## Features

- **O(n) compression cost** -- Each message is summarized at most once. No re-summarization of previously compressed content.
- **Configurable eviction triggers** -- Evict by message count, token count, a combination of both, or manually.
- **Five merge strategies** -- `summarize`, `append`, `replace`, `weighted`, and `custom` for combining new summaries with the existing anchor.
- **Tool call atomicity** -- Assistant messages with `tool_calls` and their corresponding `tool` result messages are always evicted as a single unit.
- **Serialize / deserialize** -- Save and restore compressor state across sessions or server restarts.
- **Compression statistics** -- Track total messages, compression ratio, summarizer calls, token counts, and more.
- **Lifecycle hooks** -- `onEvict`, `onCompress`, and `onError` callbacks for observability and logging.
- **Custom token counter** -- Plug in `tiktoken`, `gpt-tokenizer`, or any counting function for accurate token measurement.
- **Provider-agnostic** -- Works with any LLM. You provide the summarizer function.
- **Zero runtime dependencies** -- Ships only compiled TypeScript.

## API Reference

### `createCompressor(options): ConvoCompressor`

Creates a new compressor instance.

**Parameters:**

| Option | Type | Default | Description |
|---|---|---|---|
| `summarizer` | `SummarizerFn` | *required* | Async function that summarizes messages into a string |
| `eviction` | `EvictionConfig` | `{ trigger: 'messages', threshold: 20, target: 12 }` | When and how to evict messages from the recent window |
| `mergeStrategy` | `MergeStrategy` | `'summarize'` | How to merge a new summary with the existing anchor summary |
| `customMerge` | `CustomMergeFn` | -- | Custom merge function; required when `mergeStrategy` is `'custom'` |
| `maxSummaryTokens` | `number` | `2000` | Token budget hint passed to the summarizer via `context.targetTokens` |
| `tokenCounter` | `TokenCounter` | `Math.ceil(text.length / 4)` | Function that counts tokens in a string |
| `messageOverhead` | `number` | `4` | Tokens added per message to account for role/framing overhead |
| `summaryRole` | `'system' \| 'user'` | `'system'` | Role assigned to the summary message returned by `getMessages()` |
| `hooks` | `object` | -- | Lifecycle callbacks (see [Hooks](#hooks)) |

**Returns:** `ConvoCompressor`

---

### `deserialize(state, fns): ConvoCompressor`

Restores a compressor from a serialized `CompressorState` snapshot. Pass the same `summarizer` (and optionally `tokenCounter`, `customMerge`, `hooks`) that were used when the state was created.

```typescript
import { deserialize } from 'convo-compress';
import type { CompressorState } from 'convo-compress';

const state: CompressorState = JSON.parse(savedJson);
const compressor = deserialize(state, {
  summarizer: mySummarizer,
  tokenCounter: myTokenCounter, // optional
  customMerge: myMergeFn,       // optional
  hooks: myHooks,               // optional
});
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `state` | `CompressorState` | The serialized state object from `compressor.serialize()` |
| `fns` | `Pick<CompressorOptions, 'summarizer' \| 'tokenCounter' \| 'customMerge' \| 'hooks'>` | Functions that cannot be serialized and must be re-supplied |

**Returns:** `ConvoCompressor`

---

### `defaultSummarizationPrompt`

A string constant containing the default prompt used for summarizing evicted messages. Provided as the `defaultPrompt` field on `SummarizerContext` so your summarizer can use or ignore it.

```typescript
import { defaultSummarizationPrompt } from 'convo-compress';
```

---

### `defaultMergePrompt`

A string constant containing the default prompt used when the `summarize` or `weighted` merge strategy calls the summarizer to combine two summaries.

```typescript
import { defaultMergePrompt } from 'convo-compress';
```

---

### `defaultTokenCounter`

The built-in approximate token counter: `Math.ceil(text.length / 4)`. Exported so you can reference or wrap it.

```typescript
import { defaultTokenCounter } from 'convo-compress';

const tokens = defaultTokenCounter('Hello, world!'); // 4
```

---

### `countMessageTokens(msg, counter, overhead): number`

Counts the tokens in a single `Message` object. Sums the content tokens, plus tokens for any `tool_calls` (serialized as JSON), plus the per-message `overhead`.

```typescript
import { countMessageTokens, defaultTokenCounter } from 'convo-compress';

const tokens = countMessageTokens(
  { role: 'user', content: 'Hello!' },
  defaultTokenCounter,
  4
);
```

**Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `msg` | `Message` | The message to count tokens for |
| `counter` | `TokenCounter` | A function that counts tokens in a string |
| `overhead` | `number` | Per-message overhead tokens |

**Returns:** `number`

---

### ConvoCompressor Instance Methods

The object returned by `createCompressor()` and `deserialize()` exposes the following methods:

#### `addMessage(message: Message): void`

Adds a single message to the recent window. Updates internal statistics.

#### `addMessages(messages: Message[]): void`

Adds multiple messages to the recent window in order.

#### `getCompressed(): Promise<CompressedConversation>`

Returns the current compressed conversation: the anchored summary (or `null` if no compression has occurred) and a copy of the recent messages. If the eviction threshold is exceeded, compression is triggered automatically before returning.

```typescript
const { summary, recentMessages } = await compressor.getCompressed();
```

#### `getMessages(): Promise<Message[]>`

Returns a ready-to-send message array. If a summary exists, it is prepended as a message with the configured `summaryRole` (default `'system'`). Triggers auto-eviction if the threshold is exceeded.

```typescript
const messages = await compressor.getMessages();
// [{ role: 'system', content: '<summary>' }, ...recentMessages]
```

#### `getSummary(): string | null`

Returns the current anchored summary synchronously. Returns `null` if no compression has occurred.

#### `compress(options?: { evictCount?: number }): Promise<void>`

Manually triggers compression. When `evictCount` is provided, exactly that many messages (respecting tool call atomicity) are evicted from the front of the recent window and summarized. When omitted, the eviction count is computed from the configured `EvictionConfig`.

```typescript
await compressor.compress({ evictCount: 5 });
```

#### `getStats(): CompressionStats`

Returns a snapshot of current compression statistics.

```typescript
const stats = compressor.getStats();
// {
//   totalMessages: 45,
//   messagesCompressed: 30,
//   messagesInWindow: 15,
//   totalInputTokens: 12400,
//   summaryTokens: 320,
//   windowTokens: 4100,
//   compressionRatio: 0.667,
//   summarizationCalls: 3
// }
```

#### `resetStats(): void`

Zeros all statistics counters. Does not affect the summary or recent messages.

#### `serialize(): CompressorState`

Returns a JSON-serializable snapshot of the compressor state, including the summary, recent messages, statistics, and configuration. Use `deserialize()` to restore.

```typescript
const state = compressor.serialize();
await db.save('conversation:123', JSON.stringify(state));
```

#### `clear(): void`

Resets all state: clears the summary, removes all recent messages, and zeros all statistics.

## Configuration

### Eviction Triggers

Eviction controls when messages are removed from the recent window and compressed into the summary.

**Message count trigger** -- evict when the window exceeds a message count:

```typescript
{ trigger: 'messages', threshold: 20, target: 12 }
```

When the window reaches 20 messages, the oldest messages are evicted until 12 remain.

**Token threshold trigger** -- evict when total window tokens exceed a limit:

```typescript
{ trigger: 'tokens', threshold: 4000, target: 2000 }
```

When the window reaches 4000 tokens, the oldest messages are evicted until the window is under 2000 tokens.

**Combined trigger** -- evict when either limit is exceeded:

```typescript
{
  trigger: 'combined',
  messageThreshold: 20,
  messageTarget: 12,
  tokenThreshold: 4000,
  tokenTarget: 2000,
}
```

**Manual trigger** -- never auto-evict; call `compress()` yourself:

```typescript
{ trigger: 'manual' }
```

### Merge Strategies

When evicted messages are summarized, the resulting summary must be merged with the existing anchor. Five strategies are available:

| Strategy | Behavior | LLM Call |
|---|---|---|
| `'summarize'` | The summarizer merges both summaries into a single coherent summary | Yes |
| `'append'` | Concatenates old summary + `\n\n` + new summary | No |
| `'replace'` | New summary replaces old entirely | No |
| `'weighted'` | The summarizer merges with emphasis on recent content | Yes |
| `'custom'` | Your own merge function | Depends on implementation |

```typescript
// Using the default 'summarize' strategy
const compressor = createCompressor({
  summarizer: mySummarizer,
  mergeStrategy: 'summarize',
});

// Using a custom merge function
const compressor = createCompressor({
  summarizer: mySummarizer,
  mergeStrategy: 'custom',
  customMerge: async (oldSummary, newSummary) => {
    if (!oldSummary) return newSummary;
    return `${oldSummary}\n---\n${newSummary}`;
  },
});
```

### Token Counter

The default token counter uses `Math.ceil(text.length / 4)` as a rough approximation. For accurate counting, provide your own:

```typescript
import { encoding_for_model } from 'tiktoken';

const enc = encoding_for_model('gpt-4o');

const compressor = createCompressor({
  summarizer: mySummarizer,
  tokenCounter: (text) => enc.encode(text).length,
});
```

### Summary Role

By default, the summary is injected as a `system` message when calling `getMessages()`. Set `summaryRole` to `'user'` if your model or prompt structure requires it:

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  summaryRole: 'user',
});
```

## Error Handling

When the summarizer function throws during compression, `convo-compress` restores the evicted messages back into the recent window so no data is lost, then re-throws the error. If an `onError` hook is configured, it is called before the error propagates.

```typescript
const compressor = createCompressor({
  summarizer: async () => {
    throw new Error('LLM API unavailable');
  },
  hooks: {
    onError: (err, msgs) => {
      console.error('Compression failed:', err.message);
      console.error('Affected messages:', msgs.length);
    },
  },
});

try {
  await compressor.compress({ evictCount: 5 });
} catch (err) {
  // Messages are restored to the recent window automatically.
  // Retry later or switch to a fallback summarizer.
}
```

## Advanced Usage

### Persistence Across Sessions

Serialize the compressor state to JSON for storage in a database, file, or cache. Restore it later with the same summarizer function:

```typescript
import { createCompressor, deserialize } from 'convo-compress';
import type { CompressorState } from 'convo-compress';

// Save
const state = compressor.serialize();
await redis.set(`conv:${id}`, JSON.stringify(state));

// Restore
const raw = await redis.get(`conv:${id}`);
const restored = deserialize(JSON.parse(raw) as CompressorState, {
  summarizer: mySummarizer,
});

// Continue the conversation
restored.addMessage({ role: 'user', content: 'I am back!' });
const messages = await restored.getMessages();
```

The serialized state includes a `version: 1` field for forward-compatible schema evolution.

### Tool Call Atomicity

When an assistant message includes `tool_calls`, the assistant message and all immediately following `tool` result messages (matched by `tool_call_id`) are treated as an atomic unit during eviction. They are always evicted together, even if the requested `evictCount` would split them.

```typescript
compressor.addMessage({
  role: 'assistant',
  content: 'Let me look that up.',
  tool_calls: [{ id: 'tc_1', type: 'function', function: { name: 'search', arguments: '{"q":"weather"}' } }],
});
compressor.addMessage({
  role: 'tool',
  content: '72F and sunny',
  tool_call_id: 'tc_1',
});
compressor.addMessage({ role: 'assistant', content: 'It is 72F and sunny.' });

// Evicting 1 message will actually evict 2 (the assistant + tool pair)
await compressor.compress({ evictCount: 1 });
```

### Hooks

Lifecycle hooks provide observability into the compression pipeline:

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  hooks: {
    onEvict: (evictedMessages, triggerReason) => {
      console.log(`Evicted ${evictedMessages.length} messages (trigger: ${triggerReason})`);
    },
    onCompress: (evictedMessages, newSummary, elapsedMs) => {
      console.log(`Compressed ${evictedMessages.length} messages in ${elapsedMs}ms`);
      console.log(`Summary length: ${newSummary.length} chars`);
    },
    onError: (error, affectedMessages) => {
      console.error(`Summarization failed: ${error.message}`);
      // Messages are restored automatically; log for monitoring
    },
  },
});
```

| Hook | Signature | Called When |
|---|---|---|
| `onEvict` | `(msgs: Message[], reason: string) => void` | After messages are evicted and summarized |
| `onCompress` | `(msgs: Message[], summary: string, ms: number) => void` | After a successful compression cycle |
| `onError` | `(err: Error, msgs: Message[]) => void` | When the summarizer throws during compression |

### Monitoring Compression Efficiency

Use `getStats()` to track how effectively your summarizer is compressing conversations:

```typescript
const stats = compressor.getStats();

console.log(`Compression ratio: ${(stats.compressionRatio * 100).toFixed(1)}%`);
console.log(`Summarizer calls: ${stats.summarizationCalls}`);
console.log(`Window: ${stats.messagesInWindow} messages / ${stats.windowTokens} tokens`);
console.log(`Summary: ${stats.summaryTokens} tokens`);
```

Call `resetStats()` to zero the counters without affecting the conversation state.

### Manual Compression with Auto-Eviction Disabled

For full control over when compression happens, use `manual` eviction and call `compress()` explicitly:

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  eviction: { trigger: 'manual' },
  mergeStrategy: 'replace',
});

// Add messages freely
for (const msg of incomingMessages) {
  compressor.addMessage(msg);
}

// Compress on your own schedule
if (compressor.getStats().messagesInWindow > 30) {
  await compressor.compress({ evictCount: 20 });
}
```

## TypeScript

`convo-compress` is written in TypeScript and ships with full type declarations. All public types are exported from the package root:

```typescript
import { createCompressor, deserialize } from 'convo-compress';
import type {
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
} from 'convo-compress';
```

### Type Details

**`Message`** -- A chat message with `role` (`'system' | 'user' | 'assistant' | 'tool'`), `content` (string), and optional `tool_calls`, `tool_call_id`, and `name` fields.

**`ToolCall`** -- A tool call object with `id` (string), `type` (`'function'`), and `function` (`{ name: string; arguments: string }`).

**`SummarizerFn`** -- `(messages: Message[], context?: SummarizerContext) => Promise<string>`. The function you provide to summarize evicted messages.

**`SummarizerContext`** -- Passed as the second argument to your summarizer: `{ existingSummary: string | null; defaultPrompt: string; targetTokens?: number }`.

**`TokenCounter`** -- `(text: string) => number`. A function that counts tokens in a string.

**`MergeStrategy`** -- `'summarize' | 'append' | 'replace' | 'weighted' | 'custom'`.

**`CustomMergeFn`** -- `(oldSummary: string | null, newSummary: string) => Promise<string>`.

**`EvictionConfig`** -- A discriminated union on the `trigger` field:
- `{ trigger: 'tokens'; threshold: number; target: number }`
- `{ trigger: 'messages'; threshold: number; target: number }`
- `{ trigger: 'combined'; tokenThreshold: number; tokenTarget: number; messageThreshold: number; messageTarget: number }`
- `{ trigger: 'manual' }`

**`CompressedConversation`** -- `{ summary: string | null; recentMessages: Message[] }`.

**`CompressionStats`** -- Statistics object with fields: `totalMessages`, `messagesCompressed`, `messagesInWindow`, `totalInputTokens`, `summaryTokens`, `windowTokens`, `compressionRatio`, and `summarizationCalls`.

**`CompressorOptions`** -- Full configuration object passed to `createCompressor()`.

**`ConvoCompressor`** -- The interface returned by `createCompressor()` and `deserialize()`, exposing all instance methods.

**`CompressorState`** -- The serializable snapshot returned by `serialize()`, including `summary`, `recentMessages`, `stats`, `options`, and `version: 1`.

## License

MIT
