# convo-compress -- Specification

## 1. Overview

`convo-compress` is an incremental sliding-window chat compressor that maintains a rolling summary of older conversation content without re-summarizing previously compressed material. It implements the "anchored summary + incremental merge" pattern: a running summary (the "anchor") captures everything before the recent window, and when new messages age out of the window, only those new messages are summarized and merged with the existing anchor -- never re-processed from scratch. This makes the compression cost O(n) in the total number of messages, compared to the O(n^2) cost of naive approaches that re-summarize the entire conversation prefix every time content is evicted.

The gap this package fills is specific and measurable. The existing open-source options for conversation compression in JavaScript/TypeScript fall into two categories. First, `slimcontext` and similar packages re-summarize the entire prefix of the conversation every time new messages are evicted. If a conversation has 100 messages and messages are evicted in batches of 5, the naive approach summarizes 5 messages, then 10, then 15, and so on -- processing a cumulative total proportional to n^2 messages through the summarizer. For a 100-message conversation with eviction every 5 messages, the naive approach processes approximately 1,050 messages through the summarizer (5 + 10 + 15 + ... + 100), while the incremental approach processes exactly 100 (each message summarized once). At scale, this difference dominates both cost and latency. Second, LangChain's `ConversationSummaryBufferMemory` in Python implements a version of incremental summarization, but the JavaScript/TypeScript port is tightly coupled to LangChain's chain abstraction and memory interface -- a developer who wants incremental compression without the framework has no standalone option.

`convo-compress` is a focused compression engine, not a full context manager. It does not manage token budgets, allocate context zones, or assemble the final message array for an LLM API call. It compresses conversation content incrementally and returns the compressed result. The companion package `sliding-context` manages the full context window (system prompt, summary zone, recent zone) and can use `convo-compress` as its compression engine. The companion package `context-budget` allocates token budgets across context sections and can inform `convo-compress` how many tokens the summary should target. These packages compose: `context-budget` decides how much space the summary gets, `convo-compress` produces the summary, and `sliding-context` assembles the final message array.

`convo-compress` provides a TypeScript/JavaScript API only. No CLI. The API accepts messages, maintains the anchored summary internally, triggers compression when configurable thresholds are exceeded, and returns the compressed conversation (anchored summary plus recent messages). The package does not make HTTP requests or import any LLM provider SDK. The caller provides a summarizer function that calls whatever LLM they use, and `convo-compress` orchestrates when and what to summarize, and how to merge the result with the existing summary.

---

## 2. Goals and Non-Goals

### Goals

- Provide a `createCompressor(options)` function that returns a `ConvoCompressor` instance implementing the anchored-summary + incremental-merge compression pattern.
- Ensure each message is summarized at most once. When messages leave the recent window, summarize only those messages, merge the result with the existing anchored summary, and never re-process previously summarized content.
- Support multiple merge strategies for combining a new summary with the existing anchored summary: `summarize` (re-summarize old + new summaries into a unified summary), `append` (concatenate new summary to old), `replace` (new summary replaces old), `weighted` (re-summarize with emphasis on recent content), and `custom` (caller-provided merge function).
- Support configurable eviction triggers: token threshold (evict when recent window exceeds N tokens), message count threshold (evict when recent window exceeds N messages), and manual (caller explicitly triggers compression).
- Provide information prioritization during compression: configurable priority hints that instruct the summarizer to preserve high-value information (user preferences, decisions, key facts, named entities) and drop low-value information (pleasantries, acknowledgments, repeated content).
- Track compression statistics: total messages processed, messages compressed, compression ratio (original tokens / compressed tokens), LLM calls made, tokens saved, and estimated cost saved.
- Provide `serialize()` and `deserialize()` for persistence, enabling the compressor state (anchored summary, recent messages, statistics) to be saved and restored across sessions.
- Provide event hooks (`onCompress`, `onMerge`, `onEvict`) for observability, logging, and custom logic.
- Be provider-agnostic. Accept any summarizer function. No dependency on any LLM provider SDK.
- Keep runtime dependencies at zero. All compression logic uses built-in JavaScript APIs.
- Preserve tool call message pairs as atomic units during eviction -- when an assistant message with tool calls is evicted, its corresponding tool result messages are evicted with it.

### Non-Goals

- **Not a context manager.** This package does not manage context zones (system prompt, summary, recent), assemble final message arrays, or enforce total token budgets. It produces a compressed representation of conversation content. Use `sliding-context` for full context window management, optionally with `convo-compress` as the compression engine.
- **Not a token budget allocator.** This package does not decide how many tokens the summary should consume relative to other context sections. Use `context-budget` to allocate budgets, then pass the summary budget to `convo-compress` as the `targetSummaryTokens` option.
- **Not an LLM API client.** This package does not make HTTP requests, manage API keys, handle streaming, or parse provider-specific response envelopes. The caller provides a summarizer function that calls the LLM and returns the summary text.
- **Not a token counting library.** This package includes a rough approximate counter (`Math.ceil(text.length / 4)`) as a convenience. For accurate token counting, the caller provides a `tokenCounter` function using `tiktoken`, `gpt-tokenizer`, or another tokenizer.
- **Not a conversation branching tool.** This package compresses a single linear conversation thread. For tree-structured conversations where branches need independent compression, use `convo-tree` with `convo-compress` applied to individual branches.
- **Not a semantic deduplication tool.** This package compresses by summarization, not by removing duplicate or near-duplicate messages. For semantic deduplication prior to compression, use `memory-dedup`.
- **Not a prompt builder.** This package does not template or format the final prompt. It returns a compressed conversation (summary + recent messages) that the caller or a context manager like `sliding-context` formats for the LLM API.

---

## 3. Target Users and Use Cases

### Long-Running Chatbot Developers

Developers building chatbots where conversations regularly exceed 30-50 turns. A customer support bot running for an hour-long troubleshooting session accumulates a massive conversation history. With naive re-summarization, every time old messages are evicted, the entire accumulated summary is re-processed through the LLM -- a cost that grows quadratically. A 100-turn conversation might trigger 15-20 summarization calls, each processing progressively more content. With `convo-compress`, each summarization call processes only the newly evicted messages (typically 3-8 messages), and the merge step is either a cheap concatenation or a short re-summarization of two summary paragraphs. The cumulative LLM token cost drops by 50-80% compared to naive re-summarization. A typical integration: `const compressor = createCompressor({ summarizer: callGPT4oMini, windowSize: 20, evictionThreshold: { messages: 5 } })`.

### Agent Framework Authors

Teams building autonomous agent systems where the agent runs for many turns -- planning, executing tool calls, observing results, replanning. Agent conversations are particularly expensive to re-summarize because tool call messages contain large JSON payloads (function arguments, API responses) that inflate the token count. An agent that runs for 100 turns with 3 tool calls per turn generates 400+ messages, most of which are verbose intermediate state. `convo-compress` compresses these with information prioritization: decisions and observations are preserved while raw tool call JSON and intermediate reasoning are condensed. The incremental approach is critical here because agent conversations are the longest and most token-heavy, making the O(n) vs O(n^2) difference most pronounced.

### Cost-Conscious Production Applications

Applications running on expensive models (GPT-4, Claude Sonnet) where every token of summarization LLM usage matters. The naive approach's O(n^2) cost is not just a theoretical concern -- it manifests as real API bills. Consider a conversation with 200 messages, evicting every 10 messages. Naive re-summarization processes 10 + 20 + 30 + ... + 200 = 2,100 messages through the summarizer. Incremental compression processes exactly 200 messages through the summarizer (each batch of 10 evicted messages is summarized once) plus 19 merge calls that process two short summary paragraphs. If the summarizer model charges $0.15 per 1M input tokens and each message averages 100 tokens, naive costs approximately $0.0315 in summarization input tokens while incremental costs approximately $0.003 -- an order of magnitude less. For applications handling thousands of concurrent conversations, this difference is substantial.

### Persistent Conversation Applications

Applications that save and restore conversation state across sessions -- a user leaves a chat and returns the next day, a server restarts, a mobile app suspends. `convo-compress` provides `serialize()` and `deserialize()` so the anchored summary, recent messages, and compression statistics persist across restarts. When the conversation resumes, the compressor picks up exactly where it left off, with the anchored summary intact. No re-summarization of historical content is needed.

### Developers Using sliding-context

Developers already using `sliding-context` for context window management who want to upgrade from the basic summarization strategies to the more efficient incremental compression. `sliding-context` accepts a `summarizer` function -- the developer wraps `convo-compress` in that function, delegating the compression algorithm to `convo-compress` while `sliding-context` handles the context window orchestration. This is the primary integration point between the two packages.

### Multi-Model Routing Applications

Applications that switch between models during a conversation -- using a cheap model for simple turns and an expensive model for complex ones. When switching to a model with a smaller context window, the conversation must be compressed to fit. `convo-compress` can be triggered to force-compress the conversation to a target token count, and the incremental approach ensures that previously summarized content is not re-processed during this emergency compression.

---

## 4. Core Concepts

### Anchored Summary

The anchored summary is a running compressed representation of all conversation content that has been evicted from the recent window. It starts as `null` (no messages have been evicted yet) and grows as messages are compressed into it. The key property of the anchored summary is that it is never re-expanded or re-summarized from its source messages -- once messages are compressed into the anchored summary, the original messages are discarded and the summary is the sole record of their content. The summary is "anchored" in the sense that it is a fixed, accumulated artifact that grows monotonically. New information is merged into it; old information within it is never re-processed from scratch.

### Incremental Merge

When messages are evicted from the recent window, they are summarized into a "new summary" (a summary of just the evicted messages). This new summary must be combined with the existing anchored summary. The incremental merge is this combination step. Different merge strategies produce different quality/cost tradeoffs, but all share the property that the merge input is two summaries (old anchored + new evicted summary), not the full conversation history. This is what makes the approach incremental: the work per eviction is bounded by the size of the evicted batch plus the size of the existing summary, not the size of the entire conversation.

### Recent Window

The recent window is the set of messages kept verbatim (uncompressed) in the compressor. These are the most recent messages in the conversation. When the recent window exceeds a configured threshold (by token count or message count), the oldest messages are evicted from the window. The recent window provides two functions: it ensures the LLM sees the most recent messages in full fidelity (no information loss from compression), and it provides a buffer so that compression is not triggered on every single message addition.

### Eviction

Eviction is the process of removing the oldest messages from the recent window when a threshold is exceeded. Evicted messages are not discarded -- they are passed to the summarizer to be compressed and then merged with the anchored summary. The eviction count is configurable: evict the oldest N messages, or evict messages until the window is below the target size. Tool call pairs (an assistant message with `tool_calls` and its corresponding tool result messages) are evicted atomically -- they are never split.

### Merge Strategy

The merge strategy determines how a newly produced summary (of the just-evicted messages) is combined with the existing anchored summary. Five strategies are supported: `summarize` (LLM re-summarizes both summaries into one), `append` (concatenate), `replace` (new replaces old), `weighted` (LLM re-summarizes with emphasis on recent content), and `custom` (caller-provided function). The choice of strategy is the primary quality/cost tradeoff in the compression pipeline.

### Summarizer Function

The summarizer function is a caller-provided async function that takes messages and returns a summary string. This is the only point where an LLM is called. `convo-compress` invokes the summarizer when evicted messages need to be compressed. The summarizer also handles merging when the merge strategy is `summarize` or `weighted` -- in those cases, the two summaries (old + new) are passed to the summarizer to be combined into one.

### Compression Statistics

The compressor tracks statistics about its operation: how many messages have been processed, how many have been compressed, the compression ratio, the number of LLM calls made for summarization and merging, tokens saved, and estimated cost saved. These statistics are useful for monitoring, debugging, and cost optimization. They are included in the serialized state and persist across sessions.

---

## 5. The Compression Algorithm

### Why O(n) vs O(n^2) Matters

Consider a conversation of N messages, where eviction happens every B messages (the eviction batch size). The total number of eviction events is N/B.

**Naive re-summarization (O(n^2)):** On each eviction, the summarizer processes the entire prefix of the conversation -- the existing summary (which represents all previously evicted messages) plus the newly evicted messages. But the existing summary was itself produced by re-summarizing the previous summary and the previous batch. In effect, every piece of old content passes through the summarizer repeatedly. The total tokens processed by the summarizer across all eviction events is:

```
B + 2B + 3B + ... + N = B * (N/B * (N/B + 1)) / 2 = O(N^2 / B)
```

For N=100, B=5: 5 + 10 + 15 + ... + 100 = 1,050 messages through the summarizer.

**Incremental compression (O(n)):** On each eviction, the summarizer processes only the B newly evicted messages. The merge step processes two summaries (old anchored + new), whose combined size is bounded and does not grow proportionally to N (the anchored summary stays roughly the same size because it is itself a summary). The total tokens processed by the summarizer across all eviction events is:

```
B + B + B + ... + B = B * (N/B) = N
```

Plus merge costs: each merge processes two summary paragraphs, say S tokens each. Total merge cost is (N/B) * 2S, which is O(N/B) -- linear in the number of evictions.

For N=100, B=5: exactly 100 messages through the summarizer, plus 20 merge operations on short summaries.

### The Incremental Compression Pipeline

The compression pipeline operates as a cycle triggered by message eviction:

```
Step 1: Messages accumulate in the recent window
        ┌─────────────────────────────────────────────┐
        │  Recent Window                               │
        │  [msg1] [msg2] [msg3] ... [msgN]            │
        │                                              │
        │  Anchored Summary: (null or existing text)   │
        └─────────────────────────────────────────────┘

Step 2: Window exceeds threshold → evict oldest messages
        ┌──────────────────────────────────┐
        │  Evicted (batch)                  │
        │  [msg1] [msg2] [msg3]            │
        └───────────────┬──────────────────┘
                        │
                        ▼
Step 3: Summarize ONLY the evicted messages (LLM call #1)
        ┌──────────────────────────────────┐
        │  summarizer([msg1, msg2, msg3])  │
        │  → "New summary of msg1-3"       │
        └───────────────┬──────────────────┘
                        │
                        ▼
Step 4: Merge new summary with existing anchored summary
        ┌──────────────────────────────────────────────────┐
        │  merge(anchoredSummary, newSummary)               │
        │  Strategy: summarize | append | replace | ...    │
        │  → "Merged summary of all compressed content"    │
        └───────────────┬──────────────────────────────────┘
                        │
                        ▼
Step 5: Merged result becomes the new anchored summary
        ┌──────────────────────────────────────────────┐
        │  Anchored Summary: "Merged summary of all    │
        │  compressed content"                          │
        │                                              │
        │  Recent Window (remaining):                   │
        │  [msg4] [msg5] ... [msgN]                    │
        └──────────────────────────────────────────────┘

Repeat from Step 1 as more messages arrive.
```

### Compression Flow Over Time

The following diagram shows how the anchored summary and recent window evolve over a 20-message conversation with a window size of 8 messages and eviction batch size of 4.

```
Time    Recent Window                    Anchored Summary
────    ─────────────                    ────────────────
t=1     [m1]                             (null)
t=4     [m1, m2, m3, m4]                (null)
t=8     [m1, m2, m3, m4, m5, m6, m7, m8]  (null)

  ── window full, evict m1-m4 ──
  summarize([m1,m2,m3,m4]) → S1
  merge(null, S1)           → S1 (first summary, no merge needed)

t=9     [m5, m6, m7, m8, m9]            S1
t=12    [m5, m6, m7, m8, m9, m10, m11, m12]  S1

  ── window full, evict m5-m8 ──
  summarize([m5,m6,m7,m8]) → S2
  merge(S1, S2)             → S1+2 (merged summary)

t=13    [m9, m10, m11, m12, m13]         S1+2
t=16    [m9, m10, m11, m12, m13, m14, m15, m16]  S1+2

  ── window full, evict m9-m12 ──
  summarize([m9,m10,m11,m12]) → S3
  merge(S1+2, S3)             → S1+2+3 (merged summary)

t=17    [m13, m14, m15, m16, m17]        S1+2+3
t=20    [m13, m14, m15, m16, m17, m18, m19, m20]  S1+2+3

Key: Each message (m1-m20) passes through the summarizer exactly ONCE.
     The anchored summary is never re-expanded or re-processed from
     source messages. Only the merge step touches the anchored summary,
     and the merge input is two summary paragraphs, not the full history.
```

### Why Each Message Is Summarized Exactly Once

The invariant that makes this O(n) is: once a message is summarized and its content is absorbed into the anchored summary, the original message is discarded. The anchored summary is a lossy compressed representation. Subsequent merge operations combine two compressed representations (old summary + new summary), not the original messages. The merge operates on summaries, whose size is bounded by the `targetSummaryTokens` configuration, regardless of how many messages have been compressed into them. This is analogous to a write-ahead log with compaction: each entry is written once, compacted once, and never revisited.

---

## 6. Merge Strategies

### `summarize` (Concatenate + Re-summarize)

The old anchored summary and the new evicted-message summary are concatenated and passed to the summarizer, which produces a unified summary.

```
Input to summarizer:
  "Old summary: The user asked about order #12345. The agent confirmed it shipped March 15.
   New summary: The user reported the package hasn't arrived. The agent initiated a tracking check."

Output from summarizer:
  "The user asked about order #12345, which shipped March 15. The user reported non-arrival,
   and the agent initiated a tracking investigation."
```

**Cost per merge:** One LLM call processing two summary paragraphs (typically 200-800 tokens combined input).

**Quality:** Highest coherence. The LLM produces a unified narrative that reads naturally and can de-duplicate overlapping information between the old and new summaries.

**Tradeoff:** Most expensive merge strategy because it requires an LLM call per merge. However, the input is small (two summaries, not the full conversation), so the cost per call is low. Over a 100-message conversation with eviction every 5 messages, this adds ~20 LLM calls, each processing ~500 tokens -- approximately $0.0015 at GPT-4o-mini pricing.

**When to use:** When summary quality matters and the cost of small LLM calls is acceptable. Recommended for customer-facing chatbots and applications where the summary feeds back into the LLM as context.

### `append` (Concatenate Without Re-summarization)

The new summary is appended to the old anchored summary with a separator (configurable, default: `\n\n`).

```
Before merge:
  Anchored: "The user asked about order #12345. The agent confirmed it shipped March 15."
  New:      "The user reported the package hasn't arrived. The agent initiated a tracking check."

After merge:
  "The user asked about order #12345. The agent confirmed it shipped March 15.

   The user reported the package hasn't arrived. The agent initiated a tracking check."
```

**Cost per merge:** Zero LLM calls. String concatenation only.

**Quality:** Moderate. The summary is a sequence of paragraph-length summaries in chronological order. It preserves all information but can become long and may contain redundancies across paragraphs. Over many merges, the anchored summary grows unboundedly (each merge appends ~100-200 tokens), which eventually defeats the purpose of compression.

**Mitigation for growth:** The `maxSummaryTokens` option caps the anchored summary size. When the appended summary exceeds this cap, the oldest paragraphs are dropped from the front (FIFO), or the entire summary is re-summarized once (falling back to the `summarize` strategy for that merge only). This behavior is configured via `appendOverflowStrategy: 'truncate' | 'summarize'`.

**When to use:** When LLM call costs must be minimized and the conversation is short enough that the appended summary stays within token bounds. Good for prototyping and development.

### `replace` (New Replaces Old)

The new summary replaces the old anchored summary entirely. All information in the old anchored summary is discarded.

```
Before merge:
  Anchored: "The user asked about order #12345. The agent confirmed it shipped March 15."
  New:      "The user reported the package hasn't arrived. The agent initiated a tracking check."

After merge:
  "The user reported the package hasn't arrived. The agent initiated a tracking check."
```

**Cost per merge:** Zero LLM calls.

**Quality:** Lowest. The summary only contains information from the most recently evicted batch. All older context is permanently lost. This is equivalent to a pure sliding window without cumulative memory.

**When to use:** When only the most recent context matters and older context is irrelevant. Suitable for stateless interactions or situations where the system prompt provides all necessary background context.

### `weighted` (Re-summarize with Recency Bias)

Similar to `summarize`, but the merge prompt instructs the LLM to weight recent content more heavily. Older information is preserved at a lower fidelity (key facts only), while recent information is preserved in more detail.

```
Input to summarizer (with weighted prompt):
  "You are merging two summaries. The OLD summary contains background context. The NEW summary
   contains recent events. Produce a unified summary that preserves key facts from both, but
   with MORE DETAIL from the NEW summary and only essential facts from the OLD summary.

   OLD: The user asked about order #12345. The agent confirmed it shipped March 15.
        The user is a premium member since 2020.
   NEW: The user reported the package hasn't arrived. The agent checked tracking which shows
        delivered to the mailroom. The user says the mailroom has no record."

Output from summarizer:
  "The user (premium member) has order #12345, shipped March 15. The package shows delivered
   to the mailroom but the user reports the mailroom has no record of it."
```

**Cost per merge:** One LLM call (same as `summarize`).

**Quality:** High, with intentional recency bias. Older context is compressed more aggressively (the user's account details are condensed to "premium member") while recent events retain more detail. This matches how humans naturally summarize conversations -- recent events matter more.

**When to use:** When conversations are long and the summary must stay within a tight token budget. The recency bias prevents the summary from being dominated by old context, leaving room for recent events that are more likely to be relevant to the next turn.

### `custom` (Caller-Provided Merge Function)

The caller provides a merge function that receives the old and new summaries and returns the merged result.

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  mergeStrategy: 'custom',
  customMerge: async (oldSummary: string | null, newSummary: string) => {
    if (!oldSummary) return newSummary;
    // Custom logic: extract entities from both, deduplicate, recombine
    const oldEntities = extractEntities(oldSummary);
    const newEntities = extractEntities(newSummary);
    const merged = deduplicateEntities([...oldEntities, ...newEntities]);
    return formatEntities(merged) + '\n\n' + newSummary;
  },
});
```

**Cost per merge:** Depends entirely on the caller's implementation. May involve zero LLM calls (pure string processing), one call (like `summarize`), or multiple calls (entity extraction + merge + formatting).

**When to use:** When the application has domain-specific requirements for how summaries are structured. For example, a medical chat application might need to maintain a structured list of symptoms, diagnoses, and treatment plans, rather than a prose summary. A code assistant might need to track files modified, errors encountered, and solutions applied in a structured format.

### Merge Strategy Comparison

| Strategy | LLM Calls per Merge | Summary Growth | Quality | Best For |
|---|---|---|---|---|
| `summarize` | 1 | Bounded | Highest | Production chatbots |
| `append` | 0 | Unbounded (mitigated) | Moderate | Prototyping, cost-sensitive |
| `replace` | 0 | Fixed (latest batch) | Lowest | Stateless interactions |
| `weighted` | 1 | Bounded | High (recency-biased) | Long conversations |
| `custom` | Varies | Varies | Varies | Domain-specific needs |

---

## 7. Information Prioritization

### The Problem

Not all conversational content is equally important. A 50-message customer support conversation might contain 10 messages of critical information (the customer's name, order number, problem description, attempted solutions, resolution) and 40 messages of low-information content (greetings, acknowledgments, "let me check on that", repetitions of previously stated information). A good summarizer should preserve the 10 critical messages at high fidelity and aggressively compress or drop the 40 low-information messages.

### Priority Levels

`convo-compress` defines three priority levels for information during compression:

**High priority (always preserve):**
- User preferences and constraints ("I need this by Friday", "I'm allergic to latex")
- Decisions made ("We agreed to ship a replacement")
- Action items and commitments ("Agent will escalate to the shipping team")
- Key facts and named entities (order numbers, dates, account IDs, product names, person names)
- Error conditions and their resolutions ("The payment failed because the card expired; user updated card")
- Unresolved questions or pending items ("Still waiting for shipping team response")

**Medium priority (preserve if space allows):**
- Questions asked and their answers
- Tool call results (the outcome, not the raw JSON payload)
- Reasoning and explanations ("The delay is because the warehouse is in a different region")
- Context that may become relevant later ("The user mentioned they're traveling next week")

**Low priority (drop during compression):**
- Pleasantries and social exchanges ("Hello!", "Thank you!", "You're welcome")
- Acknowledgments and fillers ("Got it", "Sure", "I understand", "Let me look into that")
- Meta-commentary about the conversation ("As I mentioned earlier", "To summarize so far")
- Repeated information already captured in the summary
- Verbose debugging back-and-forth and intermediate reasoning steps
- Raw tool call arguments and large JSON payloads (summarize the result, not the data)

### Priority Hints in Configuration

The caller can provide priority hints that are included in the summarization prompt sent to the LLM. Priority hints are domain-specific instructions that supplement the default priority levels.

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  priorityHints: {
    alwaysPreserve: [
      'Order numbers and tracking IDs',
      'Customer tier (basic, premium, enterprise)',
      'Escalation status and ticket references',
    ],
    neverPreserve: [
      'Agent internal notes and system messages',
      'Repeated confirmations of previously stated facts',
    ],
  },
});
```

These hints are interpolated into the default summarization prompt (see section 9) and passed to the caller's summarizer function as metadata. The caller's summarizer is responsible for incorporating them into the actual LLM prompt.

### Priority Hints Do Not Guarantee Behavior

Priority hints are advisory, not enforceable. The actual information preserved depends entirely on the LLM's summarization output, which is influenced by the prompt, the model, the temperature, and the content itself. `convo-compress` provides the hints and the prompt template; the LLM decides what to keep. Callers who need guaranteed preservation of specific facts should use the `custom` merge strategy with explicit entity extraction rather than relying on LLM-based summarization.

---

## 8. Eviction Triggers

### Token Threshold

Compression is triggered when the total token count of messages in the recent window exceeds a configured threshold.

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  eviction: {
    trigger: 'tokens',
    threshold: 4000,    // Evict when recent window exceeds 4000 tokens
    target: 2500,       // Evict messages until window is at or below 2500 tokens
  },
});
```

When the recent window exceeds `threshold` tokens, the oldest messages are evicted one at a time (respecting tool call pair atomicity) until the remaining window is at or below `target` tokens. The evicted messages form the batch that is summarized and merged with the anchored summary. The `target` must be less than the `threshold` to prevent immediate re-triggering after compression.

### Message Count

Compression is triggered when the number of messages in the recent window exceeds a configured count.

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  eviction: {
    trigger: 'messages',
    threshold: 20,   // Evict when window exceeds 20 messages
    target: 12,      // Evict down to 12 messages
  },
});
```

This is simpler than token-based eviction and is useful when messages are roughly uniform in size. For conversations with highly variable message sizes (short user messages mixed with long tool call results), token-based eviction provides more predictable compression behavior.

### Combined (Default)

Both token and message count thresholds are configured. Compression is triggered when either threshold is exceeded. The eviction removes messages until both targets are satisfied.

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  eviction: {
    trigger: 'combined',
    tokenThreshold: 4000,
    tokenTarget: 2500,
    messageThreshold: 20,
    messageTarget: 12,
  },
});
```

### Manual

The caller explicitly triggers compression by calling `compressor.compress()`. No automatic eviction occurs. This gives the caller full control over when compression happens.

```typescript
const compressor = createCompressor({
  summarizer: mySummarizer,
  eviction: { trigger: 'manual' },
});

// Add many messages...
compressor.addMessage(msg1);
compressor.addMessage(msg2);
// ...

// Manually trigger compression, evicting the oldest 10 messages
await compressor.compress({ evictCount: 10 });
```

### Tool Call Pair Atomicity During Eviction

When evicting messages, tool call pairs are treated as atomic units. An assistant message with `tool_calls` and its corresponding tool result messages (matched by `tool_call_id`) are always evicted together. If evicting the next message in order would split a tool call pair, the entire pair is included in the eviction batch (even if this means the batch is slightly larger than the target). This prevents orphaned tool calls or tool results from appearing in the summarizer input or remaining in the recent window without their counterpart.

---

## 9. Summarizer Interface

### Function Signature

The summarizer is a caller-provided async function:

```typescript
type SummarizerFn = (
  messages: Message[],
  context?: SummarizerContext,
) => Promise<string>;
```

The `context` parameter provides metadata that the summarizer can use to produce better summaries:

```typescript
interface SummarizerContext {
  /** The existing anchored summary, if any. */
  existingSummary: string | null;

  /** Priority hints configured by the caller. */
  priorityHints?: PriorityHints;

  /** The default summarization prompt template (caller can use or ignore). */
  defaultPrompt: string;

  /** Target token count for the summary output. */
  targetTokens?: number;
}
```

The summarizer is invoked in two situations:

1. **Eviction summarization:** When messages are evicted from the recent window, the summarizer is called with those messages to produce a summary of the evicted batch.
2. **Merge summarization:** When the merge strategy is `summarize` or `weighted`, the summarizer is called with a synthetic message containing both the old and new summaries to produce a merged summary.

### Default Summarization Prompt

`convo-compress` exports a `defaultSummarizationPrompt` constant that callers can use in their summarizer function:

```
Summarize the following conversation messages concisely. This summary will be used
as context for continuing the conversation, so preserve information that is likely
to be relevant to future messages.

Preserve (high priority):
- Key facts, decisions, and agreements
- Named entities (people, products, order numbers, dates, IDs)
- User preferences, constraints, and requirements
- Action items, commitments, and their current status
- Unresolved questions or pending issues
- Error conditions and their resolutions

Preserve if space allows (medium priority):
- Questions asked and answers given
- Tool/function call outcomes (the result, not the raw data)
- Reasoning and explanations for decisions

Omit (low priority):
- Pleasantries, greetings, and social exchanges
- Acknowledgments ("got it", "sure", "thanks")
- Repeated information already stated
- Verbose tool call arguments and raw API responses
- Intermediate debugging steps and reasoning
- Meta-commentary about the conversation itself

Return only the summary text. No preamble, no labels, no formatting.
```

### Default Merge Prompt

For the `summarize` and `weighted` merge strategies, a separate prompt template is used:

**`summarize` merge prompt:**

```
Merge these two summaries of a conversation into a single unified summary.
The EXISTING summary covers older parts of the conversation. The NEW summary
covers more recent parts. Combine them into one coherent summary that preserves
all important information from both.

EXISTING SUMMARY:
{existingSummary}

NEW SUMMARY:
{newSummary}

Return only the merged summary text. No preamble, no labels, no formatting.
```

**`weighted` merge prompt:**

```
Merge these two summaries of a conversation into a single unified summary.
The EXISTING summary covers older parts of the conversation. The NEW summary
covers more recent parts.

IMPORTANT: Preserve MORE DETAIL from the NEW summary (recent events are more
relevant). From the EXISTING summary, preserve only essential facts, key decisions,
and named entities. Compress older context more aggressively than recent context.

EXISTING SUMMARY:
{existingSummary}

NEW SUMMARY:
{newSummary}

Return only the merged summary text. No preamble, no labels, no formatting.
```

### Provider Adapter Patterns

**OpenAI:**

```typescript
import OpenAI from 'openai';
import { createCompressor, defaultSummarizationPrompt } from 'convo-compress';

const openai = new OpenAI();

const compressor = createCompressor({
  summarizer: async (messages, context) => {
    const prompt = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: context?.defaultPrompt ?? defaultSummarizationPrompt },
        { role: 'user', content: prompt },
      ],
      temperature: 0.0,
      max_tokens: context?.targetTokens ?? 500,
    });
    return response.choices[0].message.content ?? '';
  },
  eviction: { trigger: 'messages', threshold: 20, target: 12 },
  mergeStrategy: 'summarize',
});
```

**Anthropic:**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { createCompressor, defaultSummarizationPrompt } from 'convo-compress';

const anthropic = new Anthropic();

const compressor = createCompressor({
  summarizer: async (messages, context) => {
    const prompt = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-3-5-20241022',
      max_tokens: context?.targetTokens ?? 500,
      system: context?.defaultPrompt ?? defaultSummarizationPrompt,
      messages: [{ role: 'user', content: prompt }],
    });
    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text ?? '';
  },
  eviction: { trigger: 'tokens', threshold: 4000, target: 2500 },
  mergeStrategy: 'weighted',
});
```

**Mock Summarizer for Testing:**

```typescript
import { createCompressor } from 'convo-compress';

const compressor = createCompressor({
  summarizer: async (messages) => {
    return messages
      .map(m => m.content.substring(0, 30))
      .join('; ');
  },
  eviction: { trigger: 'messages', threshold: 5, target: 3 },
  mergeStrategy: 'append',
});
```

### Summarizer Failure Handling

If the summarizer throws an error or returns an empty string:

1. The error is caught and not re-thrown. Compression failure should not crash the conversation.
2. The evicted messages are re-inserted at the front of the recent window. They are not lost.
3. The `onError` hook fires with the error and the evicted messages, allowing the caller to log, retry, or take alternative action.
4. The next eviction trigger will include these messages again, giving the summarizer another chance.
5. If the summarizer fails repeatedly and the recent window grows beyond a safety limit (`maxWindowTokens`, default: 2x the eviction threshold), emergency truncation drops the oldest evicted messages without summarization. The `onEvict` hook fires with `reason: 'truncation'` so the caller knows information was lost.

### Cost Tracking

Each time the summarizer is invoked, `convo-compress` records:

- The number of input tokens (estimated using the configured `tokenCounter`)
- The number of output tokens (estimated from the returned summary)
- Whether the call was for eviction summarization or merge summarization

These are accumulated in the `CompressionStats` and available via `compressor.getStats()`. The caller can multiply by their model's per-token pricing to compute cost.

---

## 10. API Surface

### Installation

```bash
npm install convo-compress
```

### Primary Function: `createCompressor`

```typescript
import { createCompressor } from 'convo-compress';

const compressor = createCompressor({
  summarizer: async (messages, context) => {
    // Call your LLM here
    return 'Summary of the messages';
  },
  eviction: {
    trigger: 'messages',
    threshold: 20,
    target: 12,
  },
  mergeStrategy: 'summarize',
});

// Add messages as the conversation progresses
compressor.addMessage({ role: 'user', content: 'Hello, I need help with my order.' });
compressor.addMessage({ role: 'assistant', content: 'Of course! What is your order number?' });
compressor.addMessage({ role: 'user', content: 'Order #12345.' });

// Get the compressed conversation
const compressed = await compressor.getCompressed();
// → { summary: null, recentMessages: [msg1, msg2, msg3] }
// (No compression yet -- window not full)

// After many more messages, older ones are compressed automatically
const compressed2 = await compressor.getCompressed();
// → { summary: "User asked about order #12345...", recentMessages: [...last 12 messages] }

// Get a flattened message array ready for LLM API
const messages = await compressor.getMessages();
// → [{ role: 'user', content: 'Summary of earlier conversation: ...' }, ...recent messages]
```

### Type Definitions

```typescript
// ── Message Types ───────────────────────────────────────────────────

/** A message in the LLM conversation. */
interface Message {
  /** The role of the message sender. */
  role: 'system' | 'user' | 'assistant' | 'tool';

  /** The text content of the message. */
  content: string;

  /**
   * Tool calls made by the assistant.
   * Present when role is 'assistant' and the model invoked tools.
   */
  tool_calls?: ToolCall[];

  /**
   * The ID of the tool call this message is responding to.
   * Present when role is 'tool'.
   */
  tool_call_id?: string;

  /**
   * Optional name for the message sender.
   */
  name?: string;
}

/** A tool call made by the assistant. */
interface ToolCall {
  /** Unique identifier for this tool call. */
  id: string;

  /** The type of tool call. Currently always 'function'. */
  type: 'function';

  /** The function call details. */
  function: {
    /** The name of the function to call. */
    name: string;

    /** The arguments to pass to the function, as a JSON string. */
    arguments: string;
  };
}

// ── Summarizer Types ────────────────────────────────────────────────

/**
 * Function that summarizes a set of messages.
 * The caller wraps their LLM call in this function.
 */
type SummarizerFn = (
  messages: Message[],
  context?: SummarizerContext,
) => Promise<string>;

/** Metadata passed to the summarizer function. */
interface SummarizerContext {
  /** The existing anchored summary, if any. */
  existingSummary: string | null;

  /** Priority hints configured by the caller. */
  priorityHints?: PriorityHints;

  /** The default summarization prompt template. */
  defaultPrompt: string;

  /** Target token count for the summary output. */
  targetTokens?: number;
}

/** Priority hints for information preservation during compression. */
interface PriorityHints {
  /** Strings describing what must always be preserved. */
  alwaysPreserve?: string[];

  /** Strings describing what should never be preserved. */
  neverPreserve?: string[];
}

// ── Token Counter ───────────────────────────────────────────────────

/**
 * Function that counts the number of tokens in a text string.
 */
type TokenCounter = (text: string) => number;

// ── Merge Strategy ──────────────────────────────────────────────────

/**
 * How new summaries are merged with the existing anchored summary.
 */
type MergeStrategy = 'summarize' | 'append' | 'replace' | 'weighted' | 'custom';

/**
 * Custom merge function provided by the caller.
 * Receives the old anchored summary and the new evicted-message summary.
 * Returns the merged summary.
 */
type CustomMergeFn = (
  oldSummary: string | null,
  newSummary: string,
) => Promise<string>;

// ── Eviction Configuration ──────────────────────────────────────────

/** Token-based eviction. */
interface TokenEviction {
  trigger: 'tokens';
  /** Evict when recent window exceeds this many tokens. */
  threshold: number;
  /** Evict messages until window is at or below this many tokens. */
  target: number;
}

/** Message-count-based eviction. */
interface MessageEviction {
  trigger: 'messages';
  /** Evict when recent window exceeds this many messages. */
  threshold: number;
  /** Evict messages until window has at most this many messages. */
  target: number;
}

/** Combined eviction (either threshold triggers eviction). */
interface CombinedEviction {
  trigger: 'combined';
  tokenThreshold: number;
  tokenTarget: number;
  messageThreshold: number;
  messageTarget: number;
}

/** Manual eviction (caller controls when compression happens). */
interface ManualEviction {
  trigger: 'manual';
}

type EvictionConfig = TokenEviction | MessageEviction | CombinedEviction | ManualEviction;

// ── Compressed Output ───────────────────────────────────────────────

/** The result of compression: an anchored summary plus recent messages. */
interface CompressedConversation {
  /** The anchored summary of all compressed content. Null if no compression has occurred. */
  summary: string | null;

  /** Messages in the recent window, kept verbatim. */
  recentMessages: Message[];
}

// ── Compression Statistics ──────────────────────────────────────────

/** Statistics about the compressor's operation. */
interface CompressionStats {
  /** Total messages added to the compressor. */
  totalMessages: number;

  /** Messages that have been compressed (evicted and summarized). */
  messagesCompressed: number;

  /** Messages currently in the recent window. */
  messagesInWindow: number;

  /** Total tokens across all messages ever added (estimated). */
  totalInputTokens: number;

  /** Tokens in the current anchored summary. */
  summaryTokens: number;

  /** Tokens in the current recent window. */
  windowTokens: number;

  /**
   * Compression ratio: totalInputTokens / (summaryTokens + windowTokens).
   * Higher means more compression. 1.0 means no compression.
   */
  compressionRatio: number;

  /** Number of LLM calls made for eviction summarization. */
  summarizationCalls: number;

  /** Number of LLM calls made for merge operations. */
  mergeCalls: number;

  /** Total tokens sent to the summarizer as input (estimated). */
  summarizerInputTokens: number;

  /** Total tokens received from the summarizer as output (estimated). */
  summarizerOutputTokens: number;
}

// ── Event Hooks ─────────────────────────────────────────────────────

/** Event hooks for observability and custom logic. */
interface EventHooks {
  /**
   * Called when messages are evicted from the recent window.
   * @param messages - The evicted messages.
   * @param reason - 'compression' (normal) or 'truncation' (emergency drop).
   */
  onEvict?: (messages: Message[], reason: 'compression' | 'truncation') => void;

  /**
   * Called when the summarizer produces a new summary of evicted messages.
   * @param inputMessages - The messages that were summarized.
   * @param summary - The summary produced.
   * @param durationMs - How long the summarization took.
   */
  onCompress?: (
    inputMessages: Message[],
    summary: string,
    durationMs: number,
  ) => void;

  /**
   * Called when two summaries are merged.
   * @param oldSummary - The previous anchored summary.
   * @param newSummary - The newly produced summary.
   * @param mergedSummary - The result of the merge.
   * @param strategy - The merge strategy used.
   * @param durationMs - How long the merge took.
   */
  onMerge?: (
    oldSummary: string | null,
    newSummary: string,
    mergedSummary: string,
    strategy: MergeStrategy,
    durationMs: number,
  ) => void;

  /**
   * Called when the summarizer throws an error.
   * @param error - The error thrown.
   * @param messages - The messages that failed to summarize.
   */
  onError?: (error: Error, messages: Message[]) => void;
}

// ── Compressor Options ──────────────────────────────────────────────

/** Configuration options for createCompressor. */
interface CompressorOptions {
  /**
   * The summarizer function. Required.
   * Called to summarize evicted messages and (for some merge strategies) to merge summaries.
   */
  summarizer: SummarizerFn;

  /**
   * Eviction configuration. Controls when compression is triggered.
   * Default: { trigger: 'messages', threshold: 20, target: 12 }.
   */
  eviction?: EvictionConfig;

  /**
   * How new summaries are merged with the existing anchored summary.
   * Default: 'summarize'.
   */
  mergeStrategy?: MergeStrategy;

  /**
   * Custom merge function. Required when mergeStrategy is 'custom'.
   */
  customMerge?: CustomMergeFn;

  /**
   * Maximum tokens for the anchored summary.
   * When the summary exceeds this, it is compressed (for 'append' strategy)
   * or the merge is instructed to stay within this limit.
   * Default: 1000.
   */
  maxSummaryTokens?: number;

  /**
   * Target token count for summaries produced by the summarizer.
   * Passed to the summarizer as context.targetTokens.
   * Default: undefined (no target, summarizer decides length).
   */
  targetSummaryTokens?: number;

  /**
   * Token counter function.
   * Default: approximate counter (Math.ceil(text.length / 4)).
   */
  tokenCounter?: TokenCounter;

  /**
   * Per-message token overhead (role prefix, delimiters).
   * Added to each message's content token count.
   * Default: 4.
   */
  messageOverhead?: number;

  /**
   * Priority hints for information preservation during compression.
   */
  priorityHints?: PriorityHints;

  /**
   * The role to use for the summary message in getMessages() output.
   * Default: 'user'.
   */
  summaryRole?: 'system' | 'user';

  /**
   * For the 'append' merge strategy: what to do when the appended summary
   * exceeds maxSummaryTokens.
   * - 'truncate': Drop the oldest paragraphs from the front.
   * - 'summarize': Re-summarize the entire appended summary (one-time fallback).
   * Default: 'summarize'.
   */
  appendOverflowStrategy?: 'truncate' | 'summarize';

  /**
   * Separator used between paragraphs in the 'append' merge strategy.
   * Default: '\n\n'.
   */
  appendSeparator?: string;

  /** Event hooks. */
  hooks?: EventHooks;
}

// ── ConvoCompressor Instance ────────────────────────────────────────

/** A conversation compressor instance. */
interface ConvoCompressor {
  /**
   * Add a message to the conversation.
   * If automatic eviction is configured and the threshold is exceeded,
   * the message is added but compression is deferred to the next
   * getCompressed() or getMessages() call.
   */
  addMessage(message: Message): void;

  /**
   * Add multiple messages at once.
   * Equivalent to calling addMessage() for each, but more efficient
   * for bulk loading (e.g., restoring a conversation from storage).
   */
  addMessages(messages: Message[]): void;

  /**
   * Get the compressed conversation: anchored summary + recent messages.
   * This triggers any pending compression if needed.
   * Async because it may invoke the summarizer.
   */
  getCompressed(): Promise<CompressedConversation>;

  /**
   * Get a flattened message array ready for an LLM API call.
   * If a summary exists, it is included as the first message
   * (with the configured summaryRole).
   * Async because it may invoke the summarizer.
   *
   * Returns: [summary message?, ...recent messages]
   */
  getMessages(): Promise<Message[]>;

  /**
   * Get the current anchored summary, or null if no compression has occurred.
   */
  getSummary(): string | null;

  /**
   * Force compression now, regardless of eviction thresholds.
   * Evicts the specified number of oldest messages (or all messages
   * outside the target window) and compresses them.
   *
   * @param options.evictCount - Number of oldest messages to evict.
   *   If not specified, evicts to the configured target.
   */
  compress(options?: { evictCount?: number }): Promise<void>;

  /**
   * Get compression statistics.
   */
  getStats(): CompressionStats;

  /**
   * Reset statistics counters to zero.
   * Does not affect the anchored summary or recent messages.
   */
  resetStats(): void;

  /**
   * Serialize the compressor state to a JSON-compatible object.
   * Includes the anchored summary, recent messages, statistics,
   * and configuration values. Functions are not serialized.
   */
  serialize(): CompressorState;

  /**
   * Clear all messages, the anchored summary, and statistics.
   * Configuration is preserved.
   */
  clear(): void;
}

// ── Serialized State ────────────────────────────────────────────────

/** Serializable representation of the compressor state. */
interface CompressorState {
  /** The current anchored summary. Null if no compression has occurred. */
  summary: string | null;

  /** Messages currently in the recent window. */
  recentMessages: Message[];

  /** Compression statistics. */
  stats: CompressionStats;

  /** Configuration values (excluding functions). */
  options: {
    eviction: EvictionConfig;
    mergeStrategy: MergeStrategy;
    maxSummaryTokens: number;
    targetSummaryTokens?: number;
    messageOverhead: number;
    summaryRole: 'system' | 'user';
    appendOverflowStrategy: 'truncate' | 'summarize';
    appendSeparator: string;
    priorityHints?: PriorityHints;
  };

  /** Serialization format version for forward compatibility. */
  version: 1;
}

// ── Module Exports ──────────────────────────────────────────────────

/**
 * Create a new conversation compressor.
 */
function createCompressor(options: CompressorOptions): ConvoCompressor;

/**
 * Restore a compressor from serialized state.
 *
 * @param state - The serialized compressor state from ConvoCompressor.serialize().
 * @param functions - Functions that cannot be serialized: summarizer, tokenCounter,
 *   customMerge, hooks.
 */
function deserialize(
  state: CompressorState,
  functions: {
    summarizer: SummarizerFn;
    tokenCounter?: TokenCounter;
    customMerge?: CustomMergeFn;
    hooks?: EventHooks;
  },
): ConvoCompressor;

/**
 * Default summarization prompt for use in caller-provided summarizer functions.
 */
const defaultSummarizationPrompt: string;

/**
 * Default merge prompt for the 'summarize' merge strategy.
 */
const defaultMergePrompt: string;

/**
 * Default weighted merge prompt for the 'weighted' merge strategy.
 */
const defaultWeightedMergePrompt: string;
```

### Function Signatures

```typescript
/**
 * Create a new conversation compressor.
 *
 * @param options - Configuration options including summarizer, eviction config,
 *   merge strategy, and optional priority hints.
 * @returns A ConvoCompressor instance.
 * @throws TypeError if summarizer is not a function.
 * @throws TypeError if mergeStrategy is 'custom' and customMerge is not provided.
 * @throws RangeError if eviction target >= eviction threshold.
 * @throws RangeError if maxSummaryTokens is not a positive number.
 */
function createCompressor(options: CompressorOptions): ConvoCompressor;

/**
 * Restore a compressor from serialized state.
 *
 * @param state - The serialized compressor state.
 * @param functions - Non-serializable functions (summarizer is required).
 * @returns A ConvoCompressor instance with the restored state.
 * @throws TypeError if state.version is not supported.
 * @throws TypeError if functions.summarizer is not a function.
 */
function deserialize(
  state: CompressorState,
  functions: {
    summarizer: SummarizerFn;
    tokenCounter?: TokenCounter;
    customMerge?: CustomMergeFn;
    hooks?: EventHooks;
  },
): ConvoCompressor;
```

---

## 11. Compression Statistics

### What Is Tracked

The `CompressionStats` object provides visibility into the compressor's operation:

| Field | Description | Example |
|---|---|---|
| `totalMessages` | Total messages added via `addMessage()` | 87 |
| `messagesCompressed` | Messages evicted and summarized | 60 |
| `messagesInWindow` | Messages currently in the recent window | 27 |
| `totalInputTokens` | Sum of token counts across all messages ever added | 21,450 |
| `summaryTokens` | Token count of the current anchored summary | 380 |
| `windowTokens` | Token count of messages in the recent window | 6,200 |
| `compressionRatio` | `totalInputTokens / (summaryTokens + windowTokens)` | 3.26 |
| `summarizationCalls` | Number of LLM calls for eviction summarization | 8 |
| `mergeCalls` | Number of LLM calls for merge operations | 7 |
| `summarizerInputTokens` | Total tokens sent to the summarizer as input | 15,600 |
| `summarizerOutputTokens` | Total tokens received from the summarizer as output | 2,100 |

### Compression Ratio

The compression ratio measures how much the conversation has been compressed:

```
compressionRatio = totalInputTokens / (summaryTokens + windowTokens)
```

A ratio of 1.0 means no compression (everything is in the recent window). A ratio of 3.0 means the original conversation was 3x larger than the current compressed representation. Higher ratios indicate more aggressive compression.

The ratio increases over time as more messages are compressed. For a stable conversation with consistent message sizes, the ratio approaches `totalInputTokens / (maxSummaryTokens + windowTargetTokens)` -- bounded by the summary cap and the window target size.

### Cost Estimation

The caller can estimate the cost of compression by multiplying the summarizer token counts by their model's pricing:

```typescript
const stats = compressor.getStats();
const inputCost = stats.summarizerInputTokens * (0.15 / 1_000_000); // GPT-4o-mini input
const outputCost = stats.summarizerOutputTokens * (0.60 / 1_000_000); // GPT-4o-mini output
const totalCompressionCost = inputCost + outputCost;

const tokensSavedPerCall = stats.totalInputTokens - (stats.summaryTokens + stats.windowTokens);
const savingsPerCall = tokensSavedPerCall * (0.15 / 1_000_000); // input savings per future LLM call
```

### Statistics Persistence

Statistics are included in the serialized state via `serialize()` and restored via `deserialize()`. This allows cumulative tracking across sessions. The `resetStats()` method zeroes all counters without affecting the summary or messages.

---

## 12. Configuration

### Default Values

| Option | Default | Description |
|---|---|---|
| `summarizer` | (required) | Function that calls the LLM to produce summaries. |
| `eviction` | `{ trigger: 'messages', threshold: 20, target: 12 }` | When and how to evict messages from the recent window. |
| `mergeStrategy` | `'summarize'` | How new summaries merge with the anchored summary. |
| `customMerge` | `undefined` | Custom merge function (required when strategy is `'custom'`). |
| `maxSummaryTokens` | `1000` | Maximum tokens for the anchored summary. |
| `targetSummaryTokens` | `undefined` | Target output size for summaries (passed to summarizer). |
| `tokenCounter` | `(text) => Math.ceil(text.length / 4)` | Token counting function. |
| `messageOverhead` | `4` | Per-message overhead tokens. |
| `priorityHints` | `undefined` | Information preservation hints for the summarizer. |
| `summaryRole` | `'user'` | Role for the summary message in `getMessages()` output. |
| `appendOverflowStrategy` | `'summarize'` | What to do when appended summary exceeds max tokens. |
| `appendSeparator` | `'\n\n'` | Separator for the `'append'` merge strategy. |
| `hooks` | `{}` | Event hooks. |

### Configuration Validation

All configuration values are validated at `createCompressor()` call time. Invalid values produce clear, actionable error messages:

- `summarizer` must be a function. Non-function values throw `TypeError: summarizer must be a function, received <type>`.
- `mergeStrategy` must be one of `'summarize'`, `'append'`, `'replace'`, `'weighted'`, `'custom'`. Invalid values throw `TypeError: mergeStrategy must be 'summarize', 'append', 'replace', 'weighted', or 'custom', received '<value>'`.
- When `mergeStrategy` is `'custom'`, `customMerge` must be a function. Missing or non-function values throw `TypeError: customMerge must be a function when mergeStrategy is 'custom'`.
- For token and message eviction, `target` must be less than `threshold`. Violation throws `RangeError: eviction target (20) must be less than threshold (20)`.
- `maxSummaryTokens` must be a positive number. Zero or negative values throw `RangeError: maxSummaryTokens must be a positive number, received <value>`.
- `messageOverhead` must be a non-negative integer. Negative values throw `RangeError`.
- `summaryRole` must be `'system'` or `'user'`. Invalid values throw `TypeError`.
- `appendOverflowStrategy` must be `'truncate'` or `'summarize'`. Invalid values throw `TypeError`.

---

## 13. Integration

### With sliding-context

`sliding-context` manages the full context window (system prompt, summary zone, recent messages). It accepts a `summarizer` function. `convo-compress` can serve as the compression engine inside that summarizer:

```typescript
import { createContext } from 'sliding-context';
import { createCompressor } from 'convo-compress';

const compressor = createCompressor({
  summarizer: myLLMSummarizer,
  mergeStrategy: 'weighted',
  eviction: { trigger: 'manual' }, // Let sliding-context control eviction timing
});

const ctx = createContext({
  tokenBudget: 8192,
  systemPrompt: 'You are a helpful assistant.',
  summarizer: async (messages, existingSummary) => {
    // Feed evicted messages to convo-compress
    compressor.addMessages(messages);
    await compressor.compress({ evictCount: messages.length });
    return compressor.getSummary() ?? '';
  },
});
```

In this integration, `sliding-context` decides when to summarize (based on its own budget and eviction logic), and `convo-compress` decides how to summarize (incremental compression with merge). The two packages compose at the `summarizer` function boundary.

### With context-budget

`context-budget` allocates token budgets across context sections. It can inform `convo-compress` how many tokens the summary should target:

```typescript
import { createBudget } from 'context-budget';
import { createCompressor } from 'convo-compress';

const budget = createBudget({ model: 'gpt-4o', preset: 'chatbot' });
const allocation = budget.allocate({ system: 200, conversation: 3000 });
const summaryBudget = allocation.sections.conversation.allocated * 0.3; // 30% for summary

const compressor = createCompressor({
  summarizer: myLLMSummarizer,
  maxSummaryTokens: summaryBudget,
  targetSummaryTokens: Math.floor(summaryBudget * 0.8),
});
```

### With convo-tree

`convo-tree` manages tree-structured conversations where branches diverge and can be independently explored. Each branch is a linear conversation that can be compressed independently:

```typescript
import { createTree } from 'convo-tree';
import { createCompressor } from 'convo-compress';

// Create a compressor per branch
function createBranchCompressor() {
  return createCompressor({
    summarizer: myLLMSummarizer,
    eviction: { trigger: 'messages', threshold: 15, target: 8 },
    mergeStrategy: 'summarize',
  });
}

// When a branch is selected, compress its conversation independently
const branchCompressor = createBranchCompressor();
for (const msg of branch.messages) {
  branchCompressor.addMessage(msg);
}
const compressed = await branchCompressor.getCompressed();
```

---

## 14. Edge Cases

### No Summarizer Failure, But Empty Summary Returned

If the summarizer returns an empty string (`''`), the compressor treats it the same as a failure. The evicted messages are re-inserted into the recent window, and the `onError` hook fires with a descriptive error. This prevents the anchored summary from being silently replaced with nothing.

### First Compression (No Existing Summary)

On the first eviction, there is no existing anchored summary to merge with. The merge step is skipped -- the summary of the evicted messages becomes the anchored summary directly. No merge LLM call is made for the first compression, regardless of the merge strategy.

### Evicted Batch Larger Than Target Summary

If the evicted messages contain more tokens than `maxSummaryTokens`, the summarizer must compress aggressively. The `targetSummaryTokens` value (if configured) is passed to the summarizer as a hint. If the returned summary still exceeds `maxSummaryTokens`, the merge proceeds normally but the merged summary may be truncated (for `append` strategy) or the merge prompt will instruct compression (for `summarize` and `weighted` strategies).

### Single Very Long Message

A message whose token count exceeds the entire eviction threshold. Behavior:

1. The message is added to the recent window normally.
2. If its token count alone exceeds the token threshold, eviction is triggered immediately.
3. The long message and any other oldest messages are evicted as a batch.
4. The summarizer must compress the long message. If it fails, the message is re-inserted and the overflow condition persists.
5. If the message is so long that even summarized it cannot merge within `maxSummaryTokens`, the summary will exceed the cap and overflow handling applies (per the merge strategy and `appendOverflowStrategy`).

### Tool Call Without Result

If an assistant message with `tool_calls` is added but the corresponding tool result message is never added, the orphaned tool call is evicted as a normal message when its turn comes. The summarizer receives it without a result. This is a degenerate case that the caller should avoid.

### Concurrent getCompressed() Calls

If multiple `getCompressed()` calls are in flight simultaneously (e.g., from concurrent async operations), only the first triggers compression. Subsequent calls wait for the in-flight compression to complete and then return the result. A mutex/lock ensures that two compression operations do not run concurrently on the same compressor instance.

### Rapid Message Addition

Adding many messages via `addMessage()` before calling `getCompressed()` or `getMessages()`. Eviction thresholds are checked on each `addMessage()` call, and eviction is recorded as pending but summarization is deferred until `getCompressed()` or `getMessages()` is called. This means the recent window may temporarily exceed the threshold between `addMessage()` and the next async call. This is safe -- the deferred compression processes all pending evictions in a single batch, which is more efficient than compressing after each message.

### Serialization With Pending Compression

If `serialize()` is called while there are messages that have been marked for eviction but not yet compressed (because `getCompressed()` has not been called), the serialized state includes those messages in the recent window. On deserialization, the compressor will trigger compression on the next `getCompressed()` call if the thresholds are exceeded. No data is lost.

### Empty Conversation

Calling `getCompressed()` on a compressor with no messages returns `{ summary: null, recentMessages: [] }`. Calling `getMessages()` returns `[]`. No summarization is attempted. Statistics show all zeros.

---

## 15. Testing Strategy

### Test Categories

**Unit tests: Message addition** -- Messages are added to the compressor. Tests verify they appear in `getCompressed().recentMessages` in the correct order. Tests verify token counts are computed and cached. Edge cases: empty messages, messages with only tool calls, messages with very long content.

**Unit tests: Eviction logic** -- A compressor is configured with a small threshold. Messages are added until the threshold is exceeded. Tests verify that the correct number of oldest messages are evicted (moved out of the recent window). Tests verify tool call pair atomicity: create conversations with tool call pairs at the eviction boundary and verify pairs are never split. Tests cover all eviction trigger modes (tokens, messages, combined, manual).

**Unit tests: Token counting** -- The approximate token counter is tested with English text, code, JSON, and edge cases. The pluggable counter interface is tested with a mock counter. Per-message overhead is verified.

**Integration tests: Compression pipeline** -- End-to-end tests with a mock summarizer. Messages are added to exceed the eviction threshold. Tests verify: (1) the summarizer is called with exactly the evicted messages, (2) the anchored summary is updated, (3) subsequent calls to `getCompressed()` return the correct summary and recent messages. Conversations of 50+ messages are simulated to verify that compression triggers correctly and each message is summarized exactly once.

**Integration tests: Merge strategies** -- Each merge strategy is tested with a mock summarizer. For `summarize`: verify the summarizer is called with a merge prompt containing both summaries. For `append`: verify summaries are concatenated with the separator. For `replace`: verify the old summary is discarded. For `weighted`: verify the merge prompt includes recency weighting instructions. For `custom`: verify the custom merge function is called with the correct arguments.

**Integration tests: Append overflow** -- Tests with the `append` strategy and a low `maxSummaryTokens`. Messages are added until the appended summary exceeds the cap. Tests verify that `appendOverflowStrategy: 'truncate'` drops the oldest paragraphs and `appendOverflowStrategy: 'summarize'` re-summarizes the full appended summary.

**Integration tests: Information prioritization** -- Tests where priority hints are configured. Verify that the summarizer context includes the priority hints. Verify that the default prompt includes the priority hints when they are provided.

**Integration tests: Summarizer failure** -- Mock summarizer that throws errors or returns empty strings. Verify: evicted messages are re-inserted into the recent window, `onError` hook fires, subsequent compression attempts retry, emergency truncation fires after repeated failures.

**Integration tests: Full lifecycle with serialization** -- Create a compressor, add 50+ messages, trigger multiple compressions, serialize, deserialize with new functions, continue adding messages and compressing. Verify the deserialized compressor produces identical results and statistics accumulate correctly across sessions.

**Statistics tests** -- After various compression operations, verify all `CompressionStats` fields are accurate. Verify `compressionRatio` computation. Verify `resetStats()` zeroes counters without affecting summary or messages.

**Concurrency tests** -- Call `getCompressed()` multiple times concurrently. Verify that only one compression runs at a time and all callers receive the correct result.

**Edge case tests** -- Empty conversation, single message, message exceeding the entire threshold, manual compression with `evictCount: 0`, manual compression on empty conversation, `addMessages([])` (empty array).

### Test Organization

```
src/__tests__/
  compressor.test.ts                -- Full lifecycle integration tests
  messages/
    addition.test.ts                -- Message addition and ordering
    tool-call-pairs.test.ts         -- Tool call pair atomicity
  eviction/
    token-eviction.test.ts          -- Token-threshold eviction
    message-eviction.test.ts        -- Message-count eviction
    combined-eviction.test.ts       -- Combined eviction
    manual-eviction.test.ts         -- Manual compression
  compression/
    pipeline.test.ts                -- Full compression pipeline
    first-compression.test.ts       -- First compression (no existing summary)
    incremental.test.ts             -- Each-message-summarized-once invariant
  merge/
    summarize.test.ts               -- Summarize merge strategy
    append.test.ts                  -- Append merge strategy
    replace.test.ts                 -- Replace merge strategy
    weighted.test.ts                -- Weighted merge strategy
    custom.test.ts                  -- Custom merge strategy
    append-overflow.test.ts         -- Append overflow handling
  summarizer/
    interface.test.ts               -- Summarizer context and arguments
    failure.test.ts                 -- Summarizer error handling
    prompts.test.ts                 -- Default prompt templates
  stats/
    compression-stats.test.ts       -- Statistics tracking and accuracy
    cost-estimation.test.ts         -- Cost estimation from statistics
  persistence/
    serialize.test.ts               -- Serialization
    deserialize.test.ts             -- Deserialization and version handling
    cross-session.test.ts           -- State continuity across serialize/deserialize
  hooks/
    event-hooks.test.ts             -- All event hooks fire correctly
  concurrency/
    concurrent-access.test.ts       -- Concurrent getCompressed() calls
  fixtures/
    messages.ts                     -- Test message sequences
    mock-summarizer.ts              -- Mock summarizer implementations
    mock-token-counter.ts           -- Mock token counter
```

### Test Runner

`vitest` (already configured in `package.json`).

---

## 16. Performance

### Computational Complexity

**`addMessage()`:** O(1) amortized. Appends the message to the recent window array, computes and caches its token count (one `tokenCounter` call), and checks the eviction threshold (one comparison). No async operations. No array copying.

**`getCompressed()` / `getMessages()`:** O(B) where B is the eviction batch size, when compression is triggered. The batch of evicted messages is passed to the summarizer (one LLM call), and the merge step processes two summaries (one LLM call for `summarize`/`weighted`, zero for `append`/`replace`). When no compression is needed, these methods are O(1) -- they return cached data.

**LLM call frequency:** For a conversation of N messages with eviction threshold T and target G, the number of eviction events is approximately N / (T - G). Each eviction event makes one summarization LLM call plus zero or one merge LLM call (depending on merge strategy). Total LLM calls: N / (T - G) * (1 + mergeCallFactor). For the `summarize` strategy with T=20, G=12, a 100-message conversation makes approximately 100/8 = 12.5, so 13 eviction events, each with 2 LLM calls (summarize + merge), totaling ~26 LLM calls. For the `append` strategy, the same conversation makes ~13 LLM calls (summarize only, no merge call).

**Comparison with naive O(n^2):** The naive approach processes cumulative content through the summarizer. For 100 messages with eviction every 8: the first eviction processes 8 messages, the second 16 (re-processing the previous 8 plus 8 new), the third 24, and so on. Total messages processed: 8 + 16 + 24 + ... + 100 = approximately 700 messages through the summarizer. Incremental compression processes exactly 100 messages through the summarizer (each batch of 8 is summarized once), plus ~12 merge operations on short summaries. The token savings are proportional: at 100 tokens per message, naive processes 70,000 input tokens through the summarizer vs. incremental's ~10,000 + ~6,000 merge tokens = ~16,000 total. A 4.4x reduction in summarizer input tokens.

### Memory Usage

Memory usage is proportional to the number of messages in the recent window, not the total conversation length. Evicted messages are discarded after summarization (their content exists only in the anchored summary). For a recent window of 20 messages averaging 500 characters each, memory for messages is approximately 10KB. The anchored summary is a single string, typically 200-2000 characters. Token count cache adds 8 bytes per message in the window. Total memory for a long-running compressor is bounded by the window size configuration, regardless of conversation length.

### Token Counting Performance

The approximate counter (`Math.ceil(text.length / 4)`) is O(1) per call -- JavaScript's `String.length` property is a cached field, not a computation. Exact counters are O(n) in text length, typically 1-5 million characters per second. Token counts are computed once per message on `addMessage()` and cached; `getStats()` reads cached values in O(1).

---

## 17. Dependencies

### Runtime Dependencies

None. `convo-compress` has zero required runtime dependencies. All compression logic -- eviction, merging, statistics, serialization -- uses built-in JavaScript APIs (arrays, strings, `JSON.stringify`, `Math.ceil`, `Date.now()`).

### Peer Dependencies

None. The package does not depend on any specific tokenizer or LLM SDK.

### Optional Integration Dependencies

| Package | Purpose |
|---|---|
| `gpt-tokenizer` | Exact token counting for OpenAI models. Caller provides as `tokenCounter`. |
| `js-tiktoken` | Alternative exact token counting for OpenAI models. Caller provides as `tokenCounter`. |
| `sliding-context` | Full context window management. Uses `convo-compress` as compression engine. |
| `context-budget` | Token budget allocation. Informs `convo-compress`'s `maxSummaryTokens`. |

These are not peer dependencies -- `convo-compress` has no knowledge of them. The caller uses them to implement the functions they pass in or to orchestrate higher-level workflows.

### Development Dependencies

| Package | Purpose |
|---|---|
| `typescript` | TypeScript compiler |
| `vitest` | Test runner |
| `eslint` | Linting |
| `@types/node` | Node.js type definitions |

### Why Zero Dependencies

The package orchestrates compression logic using fundamental data structures. The two external concerns -- token counting and LLM-based summarization -- are deliberately pluggable via function parameters, keeping the dependency choice with the caller. This results in zero install weight, zero supply chain risk, and zero version conflict potential.

---

## 18. File Structure

```
convo-compress/
  package.json
  tsconfig.json
  SPEC.md
  README.md
  src/
    index.ts                       -- Public API exports (createCompressor, deserialize, prompts)
    compressor.ts                  -- ConvoCompressor class implementation
    types.ts                       -- All TypeScript type definitions
    eviction.ts                    -- Eviction logic (threshold checks, tool call pair atomicity)
    merge.ts                       -- Merge strategy implementations (summarize, append, replace, weighted, custom)
    stats.ts                       -- CompressionStats tracking and computation
    token-counter.ts               -- Built-in approximate counter, counter interface
    serialization.ts               -- serialize() and deserialize() implementation
    prompts.ts                     -- Default summarization and merge prompt constants
    validation.ts                  -- Configuration validation logic
  src/__tests__/
    compressor.test.ts             -- Full lifecycle integration tests
    messages/
      addition.test.ts
      tool-call-pairs.test.ts
    eviction/
      token-eviction.test.ts
      message-eviction.test.ts
      combined-eviction.test.ts
      manual-eviction.test.ts
    compression/
      pipeline.test.ts
      first-compression.test.ts
      incremental.test.ts
    merge/
      summarize.test.ts
      append.test.ts
      replace.test.ts
      weighted.test.ts
      custom.test.ts
      append-overflow.test.ts
    summarizer/
      interface.test.ts
      failure.test.ts
      prompts.test.ts
    stats/
      compression-stats.test.ts
      cost-estimation.test.ts
    persistence/
      serialize.test.ts
      deserialize.test.ts
      cross-session.test.ts
    hooks/
      event-hooks.test.ts
    concurrency/
      concurrent-access.test.ts
    fixtures/
      messages.ts
      mock-summarizer.ts
      mock-token-counter.ts
  dist/                            -- Compiled output (generated by tsc)
```

---

## 19. Implementation Roadmap

### Phase 1: Core Compression Pipeline (v0.1.0)

Implement the foundation: message storage, eviction, summarization, and basic merging.

1. **Types**: Define all TypeScript types in `types.ts` -- `Message`, `ToolCall`, `SummarizerFn`, `SummarizerContext`, `CompressorOptions`, `CompressedConversation`, `ConvoCompressor`, `CompressorState`.
2. **Approximate token counter**: Implement the `Math.ceil(text.length / 4)` default counter with per-message overhead.
3. **Message storage**: Implement `addMessage()` and `addMessages()` -- append to the recent window array, compute and cache token counts.
4. **Eviction**: Implement message-count-based eviction. When the recent window exceeds the message threshold, evict the oldest messages down to the target count. Implement tool call pair atomicity -- detect `tool_calls` on assistant messages and find matching tool result messages by `tool_call_id`.
5. **Compression pipeline**: Implement `getCompressed()` -- when pending evictions exist, invoke the summarizer with the evicted messages, set the result as the anchored summary (first compression) or merge with existing summary.
6. **Merge strategies**: Implement `append` and `replace` strategies (no LLM call needed). Implement `summarize` strategy (LLM call with merge prompt).
7. **Configuration validation**: Validate all options at `createCompressor()` time.
8. **`getMessages()`**: Implement the flattened message array output.
9. **Default prompts**: Export `defaultSummarizationPrompt` and `defaultMergePrompt`.
10. **Tests**: Message addition, eviction, compression pipeline, append/replace/summarize merge, tool call pairs, configuration validation.

### Phase 2: Advanced Eviction and Merge (v0.2.0)

Add token-based and combined eviction, weighted and custom merge, and append overflow handling.

1. **Token-based eviction**: Implement token-threshold eviction, evicting messages until the window token count is at or below the target.
2. **Combined eviction**: Implement combined mode (either threshold triggers eviction, evict until both targets satisfied).
3. **Manual eviction**: Implement `compress()` with `evictCount` option.
4. **Weighted merge**: Implement the weighted merge strategy with the recency-biased prompt.
5. **Custom merge**: Implement the custom merge strategy delegating to `customMerge`.
6. **Append overflow**: Implement `appendOverflowStrategy` for `truncate` and `summarize` modes when the appended summary exceeds `maxSummaryTokens`.
7. **Tests**: Token eviction, combined eviction, manual compression, weighted/custom merge, append overflow.

### Phase 3: Statistics, Persistence, and Hooks (v0.3.0)

Add compression statistics, serialization/deserialization, event hooks, and priority hints.

1. **Compression statistics**: Track all fields in `CompressionStats`. Compute `compressionRatio`. Implement `getStats()` and `resetStats()`.
2. **Event hooks**: Implement `onEvict`, `onCompress`, `onMerge`, and `onError` hook invocations at the correct points in the pipeline.
3. **Priority hints**: Interpolate `priorityHints` into the `SummarizerContext` passed to the summarizer. Update default prompts to include hints when provided.
4. **Serialization**: Implement `serialize()` -- capture summary, recent messages, stats, and config as a plain object.
5. **Deserialization**: Implement `deserialize()` -- restore state from a serialized object, accept functions separately, validate version.
6. **Concurrency guard**: Implement a mutex/lock on `getCompressed()` and `getMessages()` to prevent concurrent compression operations.
7. **`clear()`**: Implement full state reset.
8. **Tests**: Statistics accuracy, hooks firing, priority hints in context, serialization round-trip, cross-session continuity, concurrent access, clear.

### Phase 4: Polish and Production Readiness (v1.0.0)

Harden for production use.

1. **Edge case hardening**: Test with extreme configurations (threshold of 2, maxSummaryTokens of 50, summarizer that always fails, messages with only tool calls, conversations of 1000+ messages).
2. **Performance profiling**: Benchmark `addMessage()` throughput with large windows (1000+ messages). Benchmark `getCompressed()` latency with various mock summarizer delays. Verify O(n) cumulative summarizer token usage over long conversations.
3. **Summarizer failure hardening**: Test repeated failures, verify emergency truncation, verify recovery after failures.
4. **Documentation**: Comprehensive README with installation, quick start, merge strategy selection guide, integration examples with `sliding-context` and `context-budget`, and cost estimation examples.

---

## 20. Example Use Cases

### Long-Running Customer Support Chatbot

A customer support chatbot that handles conversations averaging 40-60 messages over 30 minutes. The bot uses GPT-4o-mini for responses and needs to keep the context under 8K tokens for cost efficiency.

```typescript
import { createCompressor, defaultSummarizationPrompt } from 'convo-compress';
import OpenAI from 'openai';

const openai = new OpenAI();

const compressor = createCompressor({
  summarizer: async (messages, context) => {
    const formatted = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: context?.defaultPrompt ?? defaultSummarizationPrompt },
        { role: 'user', content: formatted },
      ],
      temperature: 0.0,
      max_tokens: context?.targetTokens ?? 300,
    });
    return response.choices[0].message.content ?? '';
  },
  eviction: {
    trigger: 'combined',
    tokenThreshold: 5000,
    tokenTarget: 3000,
    messageThreshold: 30,
    messageTarget: 18,
  },
  mergeStrategy: 'weighted',
  maxSummaryTokens: 800,
  targetSummaryTokens: 600,
  priorityHints: {
    alwaysPreserve: [
      'Customer name and account details',
      'Order numbers and product names',
      'Issue description and current status',
      'Escalation status and ticket IDs',
    ],
    neverPreserve: [
      'Agent greetings and closings',
      'Customer acknowledgments',
    ],
  },
  hooks: {
    onCompress: (msgs, summary, ms) => {
      console.log(`Compressed ${msgs.length} messages in ${ms}ms`);
    },
    onError: (err) => {
      console.error('Compression failed:', err.message);
    },
  },
});

// In the chat loop:
async function handleTurn(userMessage: string, botResponse: string) {
  compressor.addMessage({ role: 'user', content: userMessage });
  compressor.addMessage({ role: 'assistant', content: botResponse });

  // Get context for the next LLM call
  const messages = await compressor.getMessages();
  // messages = [summary?, ...recent messages] -- ready for the API
}
```

### Multi-Step Agent with Tool Use

An autonomous agent that executes multi-step tasks with tool calls. Agent conversations are tool-heavy and can run for 100+ turns.

```typescript
import { createCompressor } from 'convo-compress';

const compressor = createCompressor({
  summarizer: agentSummarizer,
  eviction: {
    trigger: 'tokens',
    threshold: 10000,
    target: 6000,
  },
  mergeStrategy: 'summarize',
  maxSummaryTokens: 2000,
  priorityHints: {
    alwaysPreserve: [
      'Current plan and objectives',
      'Completed steps and their outcomes',
      'Errors encountered and how they were resolved',
      'Key file paths, URLs, and identifiers',
    ],
    neverPreserve: [
      'Raw tool call JSON arguments',
      'Verbose API response bodies',
      'Intermediate reasoning that led to dead ends',
    ],
  },
});

// Agent loop
async function agentStep(observation: string) {
  compressor.addMessage({ role: 'user', content: observation });

  const context = await compressor.getMessages();
  const response = await callLLM(context);

  compressor.addMessage({
    role: 'assistant',
    content: response.content,
    tool_calls: response.toolCalls,
  });

  if (response.toolCalls) {
    for (const tc of response.toolCalls) {
      const result = await executeTool(tc);
      compressor.addMessage({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
  }
}
```

### Persistent Conversation with Session Resume

A chat application that saves conversation state when the user leaves and resumes when they return.

```typescript
import { createCompressor, deserialize } from 'convo-compress';

// Save session
async function saveSession(sessionId: string, compressor: ConvoCompressor) {
  const state = compressor.serialize();
  await redis.set(`session:${sessionId}`, JSON.stringify(state));
}

// Restore session
async function restoreSession(sessionId: string): Promise<ConvoCompressor> {
  const json = await redis.get(`session:${sessionId}`);
  if (!json) {
    return createCompressor({
      summarizer: mySummarizer,
      mergeStrategy: 'summarize',
    });
  }

  const state = JSON.parse(json);
  return deserialize(state, {
    summarizer: mySummarizer,
    tokenCounter: myTokenCounter,
  });
}

// Usage
const compressor = await restoreSession('user_abc123');
compressor.addMessage({ role: 'user', content: 'I am back!' });
const messages = await compressor.getMessages();
// → [summary of previous session, ...recent messages from previous session, new message]
```

### Cost Monitoring Dashboard

An application that tracks compression efficiency across all active conversations.

```typescript
import { createCompressor } from 'convo-compress';

// Periodically collect stats from all active compressors
function collectMetrics(compressors: Map<string, ConvoCompressor>) {
  const metrics = [];
  for (const [sessionId, compressor] of compressors) {
    const stats = compressor.getStats();
    metrics.push({
      sessionId,
      totalMessages: stats.totalMessages,
      compressionRatio: stats.compressionRatio,
      llmCalls: stats.summarizationCalls + stats.mergeCalls,
      tokensProcessed: stats.summarizerInputTokens,
      estimatedCost: (
        stats.summarizerInputTokens * 0.15 / 1_000_000 +
        stats.summarizerOutputTokens * 0.60 / 1_000_000
      ),
    });
  }
  return metrics;
}
```
