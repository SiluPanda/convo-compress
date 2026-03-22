# convo-compress — Task Breakdown

This file tracks all implementation tasks derived from [SPEC.md](./SPEC.md). Tasks are grouped into phases matching the spec's implementation roadmap (Section 19), with additional phases for testing, documentation, and publishing.

---

## Phase 0: Project Scaffolding

- [x] **Install dev dependencies** — Add `typescript`, `vitest`, `eslint`, and `@types/node` as devDependencies in `package.json`. | Status: done
- [x] **Configure vitest** — Add a `vitest.config.ts` (or configure in `package.json`) to discover test files under `src/__tests__/`. | Status: done
- [x] **Configure ESLint** — Add `.eslintrc` or `eslint.config.*` with TypeScript support. Ensure `npm run lint` works. | Status: done
- [ ] **Create source file structure** — Create all source files specified in Section 18: `src/index.ts`, `src/compressor.ts`, `src/types.ts`, `src/eviction.ts`, `src/merge.ts`, `src/stats.ts`, `src/token-counter.ts`, `src/serialization.ts`, `src/prompts.ts`, `src/validation.ts`. Populate with placeholder exports. | Status: not_done
- [ ] **Create test directory structure** — Create all test directories and fixture files specified in Section 18: `src/__tests__/`, subdirectories (`messages/`, `eviction/`, `compression/`, `merge/`, `summarizer/`, `stats/`, `persistence/`, `hooks/`, `concurrency/`, `fixtures/`). | Status: not_done
- [ ] **Create test fixtures** — Create `src/__tests__/fixtures/messages.ts` (test message sequences), `src/__tests__/fixtures/mock-summarizer.ts` (mock summarizer implementations), `src/__tests__/fixtures/mock-token-counter.ts` (mock token counter). | Status: not_done
- [x] **Verify build pipeline** — Run `npm run build` and confirm `tsc` compiles successfully with the placeholder files. | Status: done

---

## Phase 1: Core Types (src/types.ts)

- [x] **Define Message interface** — Define the `Message` interface with `role` (`'system' | 'user' | 'assistant' | 'tool'`), `content` (string), optional `tool_calls` (`ToolCall[]`), optional `tool_call_id` (string), optional `name` (string). | Status: done
- [x] **Define ToolCall interface** — Define `ToolCall` with `id` (string), `type` (`'function'`), `function` (`{ name: string; arguments: string }`). | Status: done
- [x] **Define SummarizerFn type** — Define `SummarizerFn` as `(messages: Message[], context?: SummarizerContext) => Promise<string>`. | Status: done
- [ ] **Define SummarizerContext interface** — Define with `existingSummary` (`string | null`), optional `priorityHints` (`PriorityHints`), `defaultPrompt` (string), optional `targetTokens` (number). | Status: not_done
- [ ] **Define PriorityHints interface** — Define with optional `alwaysPreserve` (`string[]`) and optional `neverPreserve` (`string[]`). | Status: not_done
- [x] **Define TokenCounter type** — Define as `(text: string) => number`. | Status: done
- [x] **Define MergeStrategy type** — Define as `'summarize' | 'append' | 'replace' | 'weighted' | 'custom'`. | Status: done
- [x] **Define CustomMergeFn type** — Define as `(oldSummary: string | null, newSummary: string) => Promise<string>`. | Status: done
- [x] **Define EvictionConfig types** — Define `TokenEviction`, `MessageEviction`, `CombinedEviction`, `ManualEviction` interfaces and the `EvictionConfig` union type. Include all fields as specified in Section 10. | Status: done
- [x] **Define CompressedConversation interface** — Define with `summary` (`string | null`) and `recentMessages` (`Message[]`). | Status: done
- [ ] **Define CompressionStats interface** — Define all 11 fields: `totalMessages`, `messagesCompressed`, `messagesInWindow`, `totalInputTokens`, `summaryTokens`, `windowTokens`, `compressionRatio`, `summarizationCalls`, `mergeCalls`, `summarizerInputTokens`, `summarizerOutputTokens`. | Status: not_done
- [ ] **Define EventHooks interface** — Define `onEvict`, `onCompress`, `onMerge`, `onError` hooks with the exact signatures from Section 10. | Status: not_done
- [ ] **Define CompressorOptions interface** — Define all 13 fields: `summarizer`, `eviction`, `mergeStrategy`, `customMerge`, `maxSummaryTokens`, `targetSummaryTokens`, `tokenCounter`, `messageOverhead`, `priorityHints`, `summaryRole`, `appendOverflowStrategy`, `appendSeparator`, `hooks`. | Status: not_done
- [x] **Define ConvoCompressor interface** — Define the public API: `addMessage()`, `addMessages()`, `getCompressed()`, `getMessages()`, `getSummary()`, `compress()`, `getStats()`, `resetStats()`, `serialize()`, `clear()`. | Status: done
- [x] **Define CompressorState interface** — Define with `summary`, `recentMessages`, `stats`, `options`, and `version: 1`. The `options` sub-object includes non-function config values. | Status: done

---

## Phase 2: Token Counter (src/token-counter.ts)

- [x] **Implement approximate token counter** — Implement the default counter: `(text: string) => Math.ceil(text.length / 4)`. Export as `approximateTokenCounter`. | Status: done
- [x] **Implement message token counting** — Create a helper function that counts tokens for a single `Message`: sum of content tokens plus `messageOverhead`. Handle messages with `tool_calls` (stringify the tool calls JSON and count those tokens too). | Status: done
- [ ] **Implement batch token counting** — Create a helper that sums token counts for an array of messages. | Status: not_done

---

## Phase 3: Prompt Constants (src/prompts.ts)

- [x] **Define defaultSummarizationPrompt** — Export the exact prompt text from Section 9 covering high/medium/low priority information. | Status: done
- [x] **Define defaultMergePrompt** — Export the `summarize` merge prompt template with `{existingSummary}` and `{newSummary}` placeholders. | Status: done
- [ ] **Define defaultWeightedMergePrompt** — Export the `weighted` merge prompt template with recency bias instructions and `{existingSummary}` / `{newSummary}` placeholders. | Status: not_done
- [ ] **Implement prompt interpolation with priority hints** — Create a helper that takes the default summarization prompt and `PriorityHints` and returns a prompt with the hints interpolated into the appropriate sections. | Status: not_done

---

## Phase 4: Configuration Validation (src/validation.ts)

- [ ] **Validate summarizer is a function** — Throw `TypeError` if `summarizer` is not a function, with message: `summarizer must be a function, received <type>`. | Status: not_done
- [ ] **Validate mergeStrategy value** — Throw `TypeError` if `mergeStrategy` is not one of `'summarize'`, `'append'`, `'replace'`, `'weighted'`, `'custom'`, with descriptive message. | Status: not_done
- [ ] **Validate customMerge when strategy is 'custom'** — Throw `TypeError` if `mergeStrategy` is `'custom'` and `customMerge` is not a function. | Status: not_done
- [ ] **Validate eviction target < threshold** — For `tokens` and `messages` triggers, throw `RangeError` if `target >= threshold`, with message showing the values. For `combined`, validate both token and message targets. | Status: not_done
- [ ] **Validate maxSummaryTokens** — Throw `RangeError` if not a positive number. | Status: not_done
- [ ] **Validate messageOverhead** — Throw `RangeError` if negative. | Status: not_done
- [ ] **Validate summaryRole** — Throw `TypeError` if not `'system'` or `'user'`. | Status: not_done
- [ ] **Validate appendOverflowStrategy** — Throw `TypeError` if not `'truncate'` or `'summarize'`. | Status: not_done
- [ ] **Apply default values** — Create a function that fills in defaults for all optional config fields: `eviction` defaults to `{ trigger: 'messages', threshold: 20, target: 12 }`, `mergeStrategy` to `'summarize'`, `maxSummaryTokens` to `1000`, `tokenCounter` to approximate counter, `messageOverhead` to `4`, `summaryRole` to `'user'`, `appendOverflowStrategy` to `'summarize'`, `appendSeparator` to `'\n\n'`. | Status: not_done

---

## Phase 5: Statistics Tracking (src/stats.ts)

- [ ] **Create CompressionStats manager** — Implement a class or factory that creates and manages a mutable `CompressionStats` object with all 11 fields initialized to zero. | Status: not_done
- [ ] **Implement stats update methods** — Methods to: increment `totalMessages`, increment `messagesCompressed`, update `messagesInWindow`, add to `totalInputTokens`, set `summaryTokens`, set `windowTokens`, increment `summarizationCalls`, increment `mergeCalls`, add to `summarizerInputTokens`, add to `summarizerOutputTokens`. | Status: not_done
- [ ] **Implement compressionRatio computation** — Compute `totalInputTokens / (summaryTokens + windowTokens)`. Return `1.0` when denominator is zero (no messages). | Status: not_done
- [x] **Implement getStats()** — Return a snapshot of current stats (including computed `compressionRatio`). | Status: done
- [x] **Implement resetStats()** — Zero all counters. Does not affect anchored summary or recent messages. | Status: done
- [x] **Implement stats restore from serialized state** — Accept a `CompressionStats` object and restore all fields. | Status: done

---

## Phase 6: Eviction Logic (src/eviction.ts)

- [x] **Implement message-count eviction check** — Given a message array and `MessageEviction` config, determine if eviction is needed (count > threshold). | Status: done
- [x] **Implement message-count eviction execution** — Remove the oldest messages from the front of the array until count <= target. Return the evicted messages and the remaining window. | Status: done
- [x] **Implement token-threshold eviction check** — Given a message array with cached token counts and `TokenEviction` config, determine if eviction is needed (total tokens > threshold). | Status: done
- [x] **Implement token-threshold eviction execution** — Remove the oldest messages until total tokens <= target. Return evicted and remaining. | Status: done
- [x] **Implement combined eviction check** — Trigger eviction if either token or message threshold is exceeded. | Status: done
- [x] **Implement combined eviction execution** — Evict messages until both token and message targets are satisfied. | Status: done
- [x] **Implement tool call pair atomicity** — When evicting, detect assistant messages with `tool_calls` and their corresponding tool result messages (matched by `tool_call_id`). Never split a tool call pair: if the assistant message is evicted, all matching tool result messages must also be evicted (even if this exceeds the target slightly). If the tool result messages are the next in line, include the assistant message too. | Status: done
- [x] **Handle edge case: tool call without result** — If an assistant message with `tool_calls` has no corresponding tool result message in the window, evict it as a normal message. | Status: done

---

## Phase 7: Merge Strategies (src/merge.ts)

- [x] **Implement 'replace' merge** — New summary replaces old anchored summary entirely. No LLM call. Return the new summary. | Status: done
- [x] **Implement 'append' merge** — Concatenate old summary + separator + new summary. Use configurable `appendSeparator` (default `'\n\n'`). No LLM call. | Status: done
- [ ] **Implement 'append' overflow handling — truncate mode** — When the appended summary exceeds `maxSummaryTokens`, drop the oldest paragraphs (split by separator) from the front until under the limit. | Status: not_done
- [ ] **Implement 'append' overflow handling — summarize mode** — When the appended summary exceeds `maxSummaryTokens`, pass the entire appended summary to the summarizer as a one-time re-summarization fallback. | Status: not_done
- [x] **Implement 'summarize' merge** — Construct the merge prompt using `defaultMergePrompt` with both summaries interpolated. Call the summarizer with a synthetic message containing the prompt. Return the summarizer's output. | Status: done
- [x] **Implement 'weighted' merge** — Construct the merge prompt using `defaultWeightedMergePrompt` with both summaries. Call the summarizer. Return the result. | Status: done
- [x] **Implement 'custom' merge** — Delegate to the caller-provided `customMerge` function, passing old and new summaries. Return its result. | Status: done
- [x] **Handle first compression (null existing summary)** — When `oldSummary` is null (first eviction), skip the merge step entirely and use the new summary directly as the anchored summary. No merge LLM call regardless of strategy. | Status: done
- [x] **Create merge strategy dispatcher** — A function that accepts the strategy name and dispatches to the correct implementation. | Status: done

---

## Phase 8: Core Compressor (src/compressor.ts)

- [x] **Implement createCompressor factory** — Accept `CompressorOptions`, validate via `validation.ts`, apply defaults, return a `ConvoCompressor` instance. | Status: done
- [x] **Implement internal state** — Maintain: recent window (Message array), anchored summary (string | null), token count cache (per message), pending eviction flag, stats manager. | Status: done
- [x] **Implement addMessage()** — Append message to recent window, compute and cache its token count, update `totalMessages` and `totalInputTokens` stats, check eviction threshold and mark eviction as pending if exceeded. Do not trigger async summarization here. | Status: done
- [x] **Implement addMessages()** — Call `addMessage()` for each message in the array. | Status: done
- [x] **Implement getCompressed()** — If eviction is pending: (1) run eviction logic to determine evicted batch, (2) call summarizer with evicted messages and `SummarizerContext`, (3) merge new summary with existing anchored summary, (4) update stats, (5) fire hooks. Return `{ summary, recentMessages }`. If no eviction pending, return cached result. | Status: done
- [x] **Implement getMessages()** — Call `getCompressed()` to ensure compression is up to date. If summary exists, prepend a message with `role: summaryRole` and `content: 'Summary of earlier conversation: ' + summary`. Return the flattened array. | Status: done
- [x] **Implement getSummary()** — Return the current anchored summary (string or null). Synchronous, does not trigger compression. | Status: done
- [x] **Implement compress()** — Force compression regardless of thresholds. Accept optional `evictCount`. If `evictCount` specified, evict that many oldest messages. If not specified, evict down to configured target. Perform the full summarize-and-merge pipeline. | Status: done
- [x] **Implement getStats()** — Delegate to stats manager. Return current statistics snapshot. | Status: done
- [x] **Implement resetStats()** — Delegate to stats manager. Zero all counters. | Status: done
- [x] **Implement clear()** — Reset anchored summary to null, clear recent window, zero stats. Preserve configuration. | Status: done
- [x] **Build SummarizerContext for eviction calls** — When calling the summarizer for eviction, construct the `SummarizerContext` with `existingSummary`, `priorityHints`, `defaultPrompt` (interpolated with hints), and `targetTokens`. | Status: done
- [ ] **Build SummarizerContext for merge calls** — When calling the summarizer for merge (summarize/weighted strategies), construct `SummarizerContext` with the merge prompt, existing summary info, and target tokens. | Status: not_done
- [x] **Implement deferred compression** — Eviction thresholds are checked on `addMessage()` but compression is deferred until `getCompressed()` or `getMessages()` is called. Multiple pending evictions are batched into a single compression operation. | Status: done

---

## Phase 9: Summarizer Failure Handling

- [x] **Catch summarizer errors** — Wrap the summarizer call in try/catch. If it throws, do not re-throw. | Status: done
- [x] **Re-insert evicted messages on failure** — If the summarizer fails, re-insert the evicted messages at the front of the recent window. No data is lost. | Status: done
- [ ] **Handle empty string return** — Treat an empty string (`''`) from the summarizer the same as a failure: re-insert messages, fire `onError` with a descriptive error. | Status: not_done
- [x] **Fire onError hook on failure** — Call the `onError` hook (if provided) with the error and the evicted messages. | Status: done
- [x] **Retry on next eviction trigger** — After a failure, the messages remain in the window. The next time an eviction trigger fires, the same messages are included again, giving the summarizer another chance. | Status: done
- [ ] **Implement emergency truncation** — If the summarizer fails repeatedly and the recent window grows beyond a safety limit (`maxWindowTokens` = 2x the eviction threshold), drop the oldest evicted messages without summarization. Fire `onEvict` with `reason: 'truncation'`. | Status: not_done

---

## Phase 10: Serialization (src/serialization.ts)

- [x] **Implement serialize()** — Produce a `CompressorState` object containing: `summary`, `recentMessages`, `stats`, `options` (all non-function config values: eviction, mergeStrategy, maxSummaryTokens, targetSummaryTokens, messageOverhead, summaryRole, appendOverflowStrategy, appendSeparator, priorityHints), and `version: 1`. | Status: done
- [x] **Implement deserialize()** — Accept a `CompressorState` and a `functions` object (`{ summarizer, tokenCounter?, customMerge?, hooks? }`). Validate `state.version === 1` (throw `TypeError` for unsupported versions). Validate `functions.summarizer` is a function. Reconstruct and return a `ConvoCompressor` instance with restored state. | Status: done
- [x] **Handle serialization with pending compression** — If `serialize()` is called while eviction is pending but compression hasn't run, include the pending messages in `recentMessages`. On deserialization, compression will trigger naturally on next `getCompressed()` call. | Status: done
- [x] **Ensure JSON compatibility** — All data in `CompressorState` must be JSON-serializable. No functions, no circular references, no special objects. | Status: done

---

## Phase 11: Event Hooks

- [x] **Fire onEvict hook** — Call `onEvict(messages, 'compression')` after messages are evicted from the recent window for normal compression. Call `onEvict(messages, 'truncation')` for emergency truncation. | Status: done
- [x] **Fire onCompress hook** — Call `onCompress(inputMessages, summary, durationMs)` after the summarizer produces a summary of evicted messages. Measure duration with `Date.now()`. | Status: done
- [ ] **Fire onMerge hook** — Call `onMerge(oldSummary, newSummary, mergedSummary, strategy, durationMs)` after the merge step completes. | Status: not_done
- [x] **Fire onError hook** — Call `onError(error, messages)` when the summarizer throws or returns empty string. | Status: done
- [ ] **Guard against hook errors** — If a hook itself throws, catch the error and do not let it disrupt the compression pipeline. | Status: not_done

---

## Phase 12: Concurrency Guard

- [ ] **Implement compression mutex** — Add a lock/mutex that prevents concurrent compression operations. If `getCompressed()` is called while a compression is already in progress, the second call waits for the first to complete and then returns the result. | Status: not_done
- [ ] **Apply mutex to getMessages()** — Since `getMessages()` calls `getCompressed()`, the mutex protects it as well. | Status: not_done
- [ ] **Apply mutex to compress()** — Manual compression via `compress()` also acquires the lock. | Status: not_done

---

## Phase 13: Public API Exports (src/index.ts)

- [x] **Export createCompressor** — Re-export the factory function from `compressor.ts`. | Status: done
- [x] **Export deserialize** — Re-export from `serialization.ts`. | Status: done
- [ ] **Export prompt constants** — Re-export `defaultSummarizationPrompt`, `defaultMergePrompt`, `defaultWeightedMergePrompt` from `prompts.ts`. | Status: not_done
- [ ] **Export all type definitions** — Re-export all interfaces and types from `types.ts`: `Message`, `ToolCall`, `SummarizerFn`, `SummarizerContext`, `PriorityHints`, `TokenCounter`, `MergeStrategy`, `CustomMergeFn`, `EvictionConfig` (and sub-types), `CompressedConversation`, `CompressionStats`, `EventHooks`, `CompressorOptions`, `ConvoCompressor`, `CompressorState`. | Status: not_done

---

## Phase 14: Unit Tests — Message Addition

- [x] **Test addMessage adds to recent window** — Add messages and verify they appear in `getCompressed().recentMessages` in correct order. | Status: done
- [x] **Test addMessages bulk add** — Add multiple messages at once and verify ordering. | Status: done
- [ ] **Test empty message content** — Add a message with `content: ''` and verify it is stored correctly. | Status: not_done
- [x] **Test message with tool_calls** — Add an assistant message with `tool_calls` and verify the tool calls are preserved. | Status: done
- [x] **Test message with tool_call_id** — Add a tool result message and verify `tool_call_id` is preserved. | Status: done
- [ ] **Test message with name field** — Add a message with `name` and verify it is preserved. | Status: not_done
- [ ] **Test very long message content** — Add a message with very long content and verify it is stored and token-counted correctly. | Status: not_done

---

## Phase 15: Unit Tests — Token Counting

- [ ] **Test approximate counter with English text** — Verify `Math.ceil(text.length / 4)` produces expected results for various English strings. | Status: not_done
- [ ] **Test approximate counter with code** — Verify with code snippets. | Status: not_done
- [ ] **Test approximate counter with JSON** — Verify with JSON strings. | Status: not_done
- [ ] **Test approximate counter with empty string** — Verify returns 0. | Status: not_done
- [x] **Test custom tokenCounter** — Provide a mock counter and verify it is used instead of the default. | Status: done
- [ ] **Test messageOverhead** — Verify that per-message overhead is added to each message's token count. | Status: not_done

---

## Phase 16: Unit Tests — Eviction Logic

- [x] **Test message-count eviction triggers at threshold** — Add messages to exceed threshold, call `getCompressed()`, verify eviction occurs and oldest messages are removed. | Status: done
- [x] **Test message-count eviction respects target** — Verify the window is reduced to the target count after eviction. | Status: done
- [x] **Test token-threshold eviction triggers** — Configure token eviction, add messages exceeding token threshold, verify eviction. | Status: done
- [ ] **Test token-threshold eviction respects target** — Verify window tokens are at or below target after eviction. | Status: not_done
- [ ] **Test combined eviction — token trigger** — In combined mode, exceed token threshold only, verify eviction fires. | Status: not_done
- [x] **Test combined eviction — message trigger** — In combined mode, exceed message threshold only, verify eviction fires. | Status: done
- [ ] **Test combined eviction — both targets satisfied** — Verify eviction continues until both token and message targets are met. | Status: not_done
- [x] **Test manual eviction with evictCount** — Call `compress({ evictCount: N })` and verify exactly N messages are evicted (respecting tool call atomicity). | Status: done
- [ ] **Test manual eviction without evictCount** — Call `compress()` with no options and verify eviction to configured target. | Status: not_done
- [ ] **Test manual eviction on empty conversation** — Call `compress()` with no messages, verify no error and no summarizer call. | Status: not_done
- [x] **Test tool call pair atomicity — pair at eviction boundary** — Place a tool call pair such that the assistant message is the last to be evicted but the tool results would be left behind. Verify the entire pair is evicted together. | Status: done
- [ ] **Test tool call pair atomicity — multi-tool-call pair** — An assistant message with multiple `tool_calls` and multiple corresponding tool results. Verify all are evicted atomically. | Status: not_done
- [ ] **Test tool call without result** — An orphaned assistant message with `tool_calls` but no matching tool result. Verify it is evicted as a normal message. | Status: not_done
- [ ] **Test eviction does not trigger on addMessage** — Verify that `addMessage()` is synchronous and does not call the summarizer. Compression is deferred. | Status: not_done

---

## Phase 17: Unit Tests — Configuration Validation

- [ ] **Test missing summarizer throws TypeError** — Call `createCompressor({})` and verify the error message. | Status: not_done
- [ ] **Test non-function summarizer throws TypeError** — Pass a string as summarizer and verify. | Status: not_done
- [ ] **Test invalid mergeStrategy throws TypeError** — Pass `'invalid'` and verify the error lists valid values. | Status: not_done
- [ ] **Test custom strategy without customMerge throws TypeError** — Set `mergeStrategy: 'custom'` without `customMerge`. | Status: not_done
- [ ] **Test eviction target >= threshold throws RangeError** — For both `tokens` and `messages` triggers. Verify error includes the values. | Status: not_done
- [ ] **Test combined eviction validation** — Validate both token and message target/threshold pairs for combined mode. | Status: not_done
- [ ] **Test maxSummaryTokens zero throws RangeError** — Pass `0`. | Status: not_done
- [ ] **Test maxSummaryTokens negative throws RangeError** — Pass `-1`. | Status: not_done
- [ ] **Test negative messageOverhead throws RangeError** — Pass `-1`. | Status: not_done
- [ ] **Test invalid summaryRole throws TypeError** — Pass `'tool'`. | Status: not_done
- [ ] **Test invalid appendOverflowStrategy throws TypeError** — Pass `'drop'`. | Status: not_done
- [ ] **Test valid configuration does not throw** — Pass a fully valid configuration and verify no error. | Status: not_done
- [ ] **Test defaults are applied** — Create compressor with only `summarizer` and verify all defaults match Section 12. | Status: not_done

---

## Phase 18: Integration Tests — Compression Pipeline

- [x] **Test full compression cycle** — Add messages beyond threshold, call `getCompressed()`, verify summarizer was called with the evicted messages, verify anchored summary is set, verify remaining messages are in recentMessages. | Status: done
- [ ] **Test summarizer receives correct messages** — Mock summarizer that records its arguments. Verify it receives exactly the evicted messages. | Status: not_done
- [ ] **Test summarizer receives SummarizerContext** — Verify the second argument includes `existingSummary`, `priorityHints`, `defaultPrompt`, and `targetTokens`. | Status: not_done
- [ ] **Test first compression skips merge** — On first eviction, verify the new summary becomes the anchored summary directly, with no merge LLM call. | Status: not_done
- [x] **Test second compression triggers merge** — On second eviction, verify merge is performed between existing summary and new summary. | Status: done
- [ ] **Test incremental invariant — each message summarized once** — Simulate a 50-message conversation. Track which messages the summarizer receives. Verify each message appears in exactly one summarizer call. | Status: not_done
- [ ] **Test multiple compression cycles** — Add messages in batches, triggering 5+ compression cycles. Verify summary accumulates and stats are correct. | Status: not_done
- [x] **Test getMessages() output format** — Verify the summary message has the correct role (`summaryRole`) and content prefix. Verify recent messages follow in order. | Status: done
- [x] **Test getMessages() with no summary** — Before any compression, verify `getMessages()` returns only the recent messages (no summary message). | Status: done
- [x] **Test getSummary() returns null before compression** — Verify returns null when no eviction has occurred. | Status: done
- [x] **Test getSummary() returns summary after compression** — Verify returns the anchored summary string after eviction. | Status: done

---

## Phase 19: Integration Tests — Merge Strategies

- [ ] **Test 'summarize' merge calls summarizer** — Verify the summarizer is called with a merge prompt containing both old and new summaries. | Status: not_done
- [ ] **Test 'summarize' merge prompt format** — Verify the merge prompt matches `defaultMergePrompt` with interpolated summaries. | Status: not_done
- [x] **Test 'append' merge concatenates** — Verify old + separator + new is the result. | Status: done
- [ ] **Test 'append' merge with custom separator** — Set `appendSeparator: '---'` and verify. | Status: not_done
- [x] **Test 'replace' merge discards old** — Verify the result is exactly the new summary. | Status: done
- [ ] **Test 'weighted' merge prompt** — Verify the merge prompt includes recency bias instructions matching `defaultWeightedMergePrompt`. | Status: not_done
- [x] **Test 'custom' merge calls customMerge** — Verify the `customMerge` function is called with old and new summaries. | Status: done
- [x] **Test 'custom' merge uses return value** — Verify the anchored summary is set to whatever `customMerge` returns. | Status: done
- [ ] **Test 'append' overflow with truncate strategy** — Configure low `maxSummaryTokens` and `appendOverflowStrategy: 'truncate'`. Add enough messages to overflow. Verify oldest paragraphs are dropped from the front. | Status: not_done
- [ ] **Test 'append' overflow with summarize strategy** — Configure `appendOverflowStrategy: 'summarize'`. Overflow the summary. Verify the summarizer is called to re-summarize the full appended summary. | Status: not_done

---

## Phase 20: Integration Tests — Summarizer Failure

- [ ] **Test summarizer error re-inserts messages** — Mock summarizer that throws. Verify evicted messages are returned to the recent window. | Status: not_done
- [x] **Test summarizer error fires onError hook** — Verify `onError` is called with the error and the evicted messages. | Status: done
- [ ] **Test summarizer empty string treated as failure** — Mock summarizer returning `''`. Verify same behavior as thrown error. | Status: not_done
- [ ] **Test retry on subsequent compression** — After failure, add more messages and trigger compression again. Verify the previously failed messages are included in the next eviction batch. | Status: not_done
- [ ] **Test emergency truncation** — Mock summarizer that always fails. Add messages until the window reaches 2x the eviction threshold. Verify oldest messages are dropped, `onEvict` fires with `reason: 'truncation'`. | Status: not_done
- [ ] **Test recovery after failure** — Mock summarizer that fails once then succeeds. Verify the system recovers and the second attempt succeeds. | Status: not_done

---

## Phase 21: Integration Tests — Priority Hints

- [ ] **Test priorityHints passed to summarizer context** — Configure `priorityHints`. Verify the summarizer receives them in `context.priorityHints`. | Status: not_done
- [ ] **Test default prompt includes hints** — When `priorityHints` are set, verify `context.defaultPrompt` includes the hint strings. | Status: not_done
- [ ] **Test no hints passes unmodified prompt** — When `priorityHints` is undefined, verify the default prompt is the standard one without hint sections. | Status: not_done

---

## Phase 22: Integration Tests — Serialization & Persistence

- [x] **Test serialize() produces valid CompressorState** — Verify all fields are present: `summary`, `recentMessages`, `stats`, `options`, `version`. | Status: done
- [ ] **Test serialized state is JSON-serializable** — Call `JSON.stringify()` on the result and then `JSON.parse()`. Verify round-trip fidelity. | Status: not_done
- [x] **Test deserialize() restores state** — Serialize, deserialize, verify `getSummary()`, `getCompressed()`, and `getStats()` return the same values. | Status: done
- [ ] **Test deserialize() requires summarizer** — Call `deserialize()` without `functions.summarizer` and verify `TypeError`. | Status: not_done
- [ ] **Test deserialize() validates version** — Pass `version: 2` and verify `TypeError` for unsupported version. | Status: not_done
- [x] **Test cross-session continuity** — Create compressor, add 50 messages with multiple compressions, serialize, deserialize, add 50 more messages with compressions. Verify stats accumulate correctly across sessions and incremental invariant holds. | Status: done
- [ ] **Test serialize with pending compression** — Add messages past threshold but don't call `getCompressed()`. Serialize. Verify pending messages are in `recentMessages`. Deserialize and call `getCompressed()`. Verify compression triggers. | Status: not_done

---

## Phase 23: Integration Tests — Statistics

- [ ] **Test initial stats are all zeros** — Create compressor and verify `getStats()` returns zeros. | Status: not_done
- [x] **Test totalMessages increments on addMessage** — Add 5 messages, verify `totalMessages === 5`. | Status: done
- [x] **Test messagesCompressed after eviction** — Trigger eviction of N messages, verify `messagesCompressed === N`. | Status: done
- [x] **Test messagesInWindow accuracy** — After adding and evicting, verify `messagesInWindow` matches the actual window size. | Status: done
- [x] **Test totalInputTokens accumulation** — Add messages with known token counts, verify `totalInputTokens` matches the sum. | Status: done
- [ ] **Test summaryTokens after compression** — After compression, verify `summaryTokens` matches the token count of the anchored summary. | Status: not_done
- [ ] **Test windowTokens accuracy** — Verify `windowTokens` matches the sum of token counts of messages in the window. | Status: not_done
- [x] **Test compressionRatio computation** — After compression, verify `compressionRatio === totalInputTokens / (summaryTokens + windowTokens)`. | Status: done
- [x] **Test summarizationCalls count** — Trigger multiple compressions, verify `summarizationCalls` matches the expected count. | Status: done
- [ ] **Test mergeCalls count** — For 'summarize' strategy with N evictions, verify `mergeCalls === N - 1` (first eviction has no merge). | Status: not_done
- [ ] **Test summarizerInputTokens accumulation** — Verify input tokens sent to summarizer are tracked. | Status: not_done
- [ ] **Test summarizerOutputTokens accumulation** — Verify output tokens received from summarizer are tracked. | Status: not_done
- [x] **Test resetStats() zeroes counters** — Call `resetStats()` and verify all stats are zero. Verify summary and messages are not affected. | Status: done

---

## Phase 24: Integration Tests — Event Hooks

- [x] **Test onEvict fires on compression** — Verify `onEvict` is called with the evicted messages and `reason: 'compression'`. | Status: done
- [ ] **Test onEvict fires on truncation** — Verify `onEvict` is called with `reason: 'truncation'` during emergency truncation. | Status: not_done
- [x] **Test onCompress fires with correct args** — Verify `onCompress` receives `inputMessages`, `summary`, and `durationMs > 0`. | Status: done
- [ ] **Test onMerge fires with correct args** — Verify `onMerge` receives `oldSummary`, `newSummary`, `mergedSummary`, `strategy`, and `durationMs`. | Status: not_done
- [ ] **Test onMerge does not fire on first compression** — First eviction skips merge; verify `onMerge` is not called. | Status: not_done
- [x] **Test onError fires on summarizer failure** — Verify `onError` receives the error and failed messages. | Status: done
- [ ] **Test hook error does not crash pipeline** — Provide a hook that throws. Verify compression completes successfully despite the hook error. | Status: not_done
- [ ] **Test hooks not called when not provided** — Create compressor without hooks. Trigger compression. Verify no errors (no attempt to call undefined hooks). | Status: not_done

---

## Phase 25: Integration Tests — Concurrency

- [ ] **Test concurrent getCompressed() calls** — Call `getCompressed()` multiple times without awaiting. Verify the summarizer is called only once and all callers receive the same result. | Status: not_done
- [ ] **Test concurrent getMessages() calls** — Same as above but with `getMessages()`. | Status: not_done
- [ ] **Test concurrent compress() and getCompressed()** — Call both concurrently. Verify no race conditions or duplicate compressions. | Status: not_done

---

## Phase 26: Edge Case Tests

- [ ] **Test empty conversation** — `getCompressed()` returns `{ summary: null, recentMessages: [] }`. `getMessages()` returns `[]`. Stats are all zeros. | Status: not_done
- [ ] **Test single message** — Add one message. No eviction. `getCompressed()` returns it in `recentMessages`. | Status: not_done
- [ ] **Test message exceeding entire threshold** — Add one message whose token count exceeds the token eviction threshold. Verify eviction triggers immediately and the summarizer is called with just that message. | Status: not_done
- [x] **Test compress with evictCount: 0** — Call `compress({ evictCount: 0 })`. Verify no eviction occurs and no summarizer call. | Status: done
- [ ] **Test addMessages with empty array** — Call `addMessages([])`. Verify no error and no state change. | Status: not_done
- [ ] **Test rapid message addition** — Add 100 messages without calling `getCompressed()`. Then call `getCompressed()`. Verify all pending evictions are handled in a single batch. | Status: not_done
- [ ] **Test conversation with only system messages** — Add only system-role messages and verify normal eviction behavior. | Status: not_done
- [ ] **Test conversation with only tool messages** — Add tool messages without corresponding assistant messages. Verify they are evicted normally. | Status: not_done

---

## Phase 27: Full Lifecycle Integration Test

- [ ] **Test compressor.test.ts full lifecycle** — Create a compressor with realistic config. Simulate a 100+ message conversation with user/assistant/tool messages. Trigger multiple compression cycles. Verify: (a) each message is summarized exactly once, (b) statistics are accurate, (c) `getCompressed()` returns correct summary + recent window at each step, (d) serialize/deserialize mid-conversation and continue, (e) hooks fire at correct times. | Status: not_done

---

## Phase 28: Documentation

- [x] **Write README.md** — Comprehensive README with: package description, installation, quick start, API reference (createCompressor, deserialize, prompt constants), configuration options table, merge strategy selection guide, eviction trigger guide, priority hints usage, serialization/deserialization, integration examples with `sliding-context` and `context-budget`, cost estimation example, provider adapter examples (OpenAI, Anthropic), mock summarizer for testing. | Status: done
- [ ] **Add JSDoc comments to all public exports** — Ensure all exported functions, types, and constants have JSDoc comments matching the spec. | Status: not_done
- [ ] **Add inline code comments for complex logic** — Comment the eviction algorithm, tool call pair detection, concurrency mutex, and append overflow handling. | Status: not_done

---

## Phase 29: Final Build & Publish Prep

- [x] **Version bump** — Confirm `package.json` version matches the current phase (start at `0.1.0` for Phase 1 core). | Status: done
- [ ] **Verify npm run build** — Run `tsc` and verify clean compilation with no errors. | Status: not_done
- [ ] **Verify npm run test** — Run `vitest run` and verify all tests pass. | Status: not_done
- [ ] **Verify npm run lint** — Run ESLint and verify no errors. | Status: not_done
- [ ] **Verify package.json fields** — Confirm `main`, `types`, `files`, `engines`, `publishConfig`, `keywords`, `description`, `license` are correct. Add relevant `keywords` (e.g., `compression`, `llm`, `conversation`, `summarization`, `sliding-window`, `context`). | Status: not_done
- [x] **Verify dist output** — Run build and verify `dist/index.js` and `dist/index.d.ts` are generated with correct exports. | Status: done
- [ ] **Dry-run publish** — Run `npm pack` and inspect the tarball contents. Verify only `dist/` is included. | Status: not_done
