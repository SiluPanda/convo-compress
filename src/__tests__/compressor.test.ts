import { describe, it, expect, vi } from 'vitest';
import { createCompressor, deserialize } from '../index.js';
import type { Message, SummarizerFn } from '../index.js';

const mockSummarizer: SummarizerFn = async (messages) =>
  'Summary: ' + messages.map((m) => m.content).join('; ');

function makeMsg(role: Message['role'], content: string): Message {
  return { role, content };
}

describe('addMessage / addMessages', () => {
  it('populates recentMessages', () => {
    const c = createCompressor({ summarizer: mockSummarizer, eviction: { trigger: 'manual' } });
    c.addMessage(makeMsg('user', 'hello'));
    c.addMessage(makeMsg('assistant', 'hi'));
    const stats = c.getStats();
    expect(stats.totalMessages).toBe(2);
    expect(stats.messagesInWindow).toBe(2);
  });

  it('addMessages adds multiple at once', () => {
    const c = createCompressor({ summarizer: mockSummarizer, eviction: { trigger: 'manual' } });
    c.addMessages([makeMsg('user', 'a'), makeMsg('user', 'b'), makeMsg('assistant', 'c')]);
    expect(c.getStats().totalMessages).toBe(3);
  });
});

describe('getCompressed()', () => {
  it('returns summary and recentMessages structure', async () => {
    const c = createCompressor({ summarizer: mockSummarizer, eviction: { trigger: 'manual' } });
    c.addMessage(makeMsg('user', 'hello'));
    const result = await c.getCompressed();
    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('recentMessages');
    expect(result.summary).toBeNull();
    expect(result.recentMessages).toHaveLength(1);
  });

  it('returns copies, not references', async () => {
    const c = createCompressor({ summarizer: mockSummarizer, eviction: { trigger: 'manual' } });
    c.addMessage(makeMsg('user', 'x'));
    const r1 = await c.getCompressed();
    c.addMessage(makeMsg('user', 'y'));
    const r2 = await c.getCompressed();
    expect(r1.recentMessages).toHaveLength(1);
    expect(r2.recentMessages).toHaveLength(2);
  });
});

describe('compress()', () => {
  it('reduces recentMessages and sets summary', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
    });
    c.addMessages([
      makeMsg('user', 'hello'),
      makeMsg('assistant', 'world'),
      makeMsg('user', 'foo'),
    ]);
    await c.compress({ evictCount: 2 });
    expect(c.getSummary()).toBe('Summary: hello; world');
    expect(c.getStats().messagesInWindow).toBe(1);
  });

  it('is a no-op when evictCount is 0', async () => {
    const c = createCompressor({ summarizer: mockSummarizer, eviction: { trigger: 'manual' } });
    c.addMessage(makeMsg('user', 'hi'));
    await c.compress({ evictCount: 0 });
    expect(c.getSummary()).toBeNull();
    expect(c.getStats().messagesInWindow).toBe(1);
  });
});

describe('message eviction trigger', () => {
  it('auto-evicts when message threshold is hit via getCompressed()', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'messages', threshold: 3, target: 1 },
      mergeStrategy: 'replace',
    });
    c.addMessages([
      makeMsg('user', 'a'),
      makeMsg('assistant', 'b'),
      makeMsg('user', 'c'),
    ]);
    const result = await c.getCompressed();
    // threshold=3, target=1 → evict 2 oldest
    expect(result.summary).not.toBeNull();
    expect(result.recentMessages.length).toBeLessThan(3);
  });
});

describe('token eviction trigger', () => {
  it('auto-evicts when token threshold is hit', async () => {
    // Each message content "hello" is 5 chars → ~2 tokens + overhead 4 = 6 tokens per msg
    // threshold = 10 tokens → should fire after 2 messages (12 tokens)
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'tokens', threshold: 10, target: 4 },
      mergeStrategy: 'replace',
    });
    c.addMessage(makeMsg('user', 'hello'));
    c.addMessage(makeMsg('assistant', 'world'));
    const result = await c.getCompressed();
    expect(result.summary).not.toBeNull();
  });
});

describe('tool_call atomicity', () => {
  it('evicts assistant+tool messages as an atomic unit', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
    });

    const assistantMsg: Message = {
      role: 'assistant',
      content: 'calling tool',
      tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'fn', arguments: '{}' } }],
    };
    const toolMsg: Message = {
      role: 'tool',
      content: 'tool result',
      tool_call_id: 'tc1',
    };

    c.addMessage(assistantMsg);
    c.addMessage(toolMsg);
    c.addMessage(makeMsg('user', 'follow-up'));

    // evictCount=1 → atomic group includes assistant + tool = 2 messages evicted
    await c.compress({ evictCount: 1 });

    const remaining = c.getStats().messagesInWindow;
    // The atomic group (assistant + tool) was evicted together, leaving only 'follow-up'
    expect(remaining).toBe(1);
    expect(c.getSummary()).toContain('calling tool');
  });

  it('keeps tool message with its assistant when evicting', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
    });

    const assistantMsg: Message = {
      role: 'assistant',
      content: 'tool call',
      tool_calls: [{ id: 'tc2', type: 'function', function: { name: 'fn2', arguments: '{}' } }],
    };
    const toolMsg: Message = { role: 'tool', content: 'result', tool_call_id: 'tc2' };

    c.addMessages([assistantMsg, toolMsg, makeMsg('user', 'next')]);

    const compressed = await c.getCompressed();
    // manual eviction = no auto-eviction
    expect(compressed.recentMessages).toHaveLength(3);
  });
});

describe('serialize / deserialize roundtrip', () => {
  it('preserves summary and recentMessages', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
    });
    c.addMessages([makeMsg('user', 'a'), makeMsg('assistant', 'b'), makeMsg('user', 'c')]);
    await c.compress({ evictCount: 2 });

    const state = c.serialize();
    const c2 = deserialize(state, { summarizer: mockSummarizer });

    expect(c2.getSummary()).toBe(c.getSummary());
    const stats2 = c2.getStats();
    expect(stats2.messagesCompressed).toBe(c.getStats().messagesCompressed);
    expect(stats2.messagesInWindow).toBe(c.getStats().messagesInWindow);
  });

  it('restored compressor continues to work after restore', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
    });
    c.addMessage(makeMsg('user', 'x'));
    await c.compress({ evictCount: 1 });

    const c2 = deserialize(c.serialize(), { summarizer: mockSummarizer });
    c2.addMessage(makeMsg('user', 'new message'));
    await c2.compress({ evictCount: 1 });
    expect(c2.getSummary()).not.toBeNull();
  });

  it('serialize includes version=1', () => {
    const c = createCompressor({ summarizer: mockSummarizer, eviction: { trigger: 'manual' } });
    expect(c.serialize().version).toBe(1);
  });
});

describe('merge strategies', () => {
  it('append combines old and new summary with separator', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'append',
    });
    c.addMessages([makeMsg('user', 'first'), makeMsg('assistant', 'second')]);
    await c.compress({ evictCount: 2 });
    const firstSummary = c.getSummary();

    c.addMessages([makeMsg('user', 'third'), makeMsg('assistant', 'fourth')]);
    await c.compress({ evictCount: 2 });

    // Second summary should contain the first summary appended with the new one
    expect(c.getSummary()).toContain(firstSummary!);
    expect(c.getSummary()).toContain('third');
  });

  it('replace replaces old summary with new', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
    });
    c.addMessages([makeMsg('user', 'old1'), makeMsg('assistant', 'old2')]);
    await c.compress({ evictCount: 2 });

    c.addMessages([makeMsg('user', 'new1'), makeMsg('assistant', 'new2')]);
    await c.compress({ evictCount: 2 });

    // Should only contain new content, not old
    expect(c.getSummary()).toBe('Summary: new1; new2');
  });

  it('custom merge function is called', async () => {
    const customMerge = vi.fn(async (_old: string | null, newS: string) => `CUSTOM:${newS}`);
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'custom',
      customMerge,
    });
    c.addMessages([makeMsg('user', 'a'), makeMsg('assistant', 'b')]);
    await c.compress({ evictCount: 2 });
    c.addMessages([makeMsg('user', 'c'), makeMsg('assistant', 'd')]);
    await c.compress({ evictCount: 2 });
    expect(customMerge).toHaveBeenCalled();
    expect(c.getSummary()).toMatch(/^CUSTOM:/);
  });
});

describe('clear()', () => {
  it('resets all state', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
    });
    c.addMessages([makeMsg('user', 'a'), makeMsg('assistant', 'b')]);
    await c.compress({ evictCount: 2 });

    c.clear();

    expect(c.getSummary()).toBeNull();
    const stats = c.getStats();
    expect(stats.totalMessages).toBe(0);
    expect(stats.messagesCompressed).toBe(0);
    expect(stats.messagesInWindow).toBe(0);
    expect(stats.summarizationCalls).toBe(0);
  });
});

describe('getStats()', () => {
  it('returns correct counts after operations', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
    });
    c.addMessages([makeMsg('user', 'a'), makeMsg('assistant', 'b'), makeMsg('user', 'c')]);
    await c.compress({ evictCount: 2 });

    const stats = c.getStats();
    expect(stats.totalMessages).toBe(3);
    expect(stats.messagesCompressed).toBe(2);
    expect(stats.messagesInWindow).toBe(1);
    expect(stats.summarizationCalls).toBe(1);
    expect(stats.compressionRatio).toBeCloseTo(2 / 3);
  });

  it('tracks totalInputTokens', () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      tokenCounter: (t) => t.length, // 1 token per char for predictability
      messageOverhead: 0,
    });
    c.addMessage(makeMsg('user', 'abcde')); // 5 chars = 5 tokens
    expect(c.getStats().totalInputTokens).toBe(5);
  });
});

describe('hooks', () => {
  it('onEvict is called with evicted messages and reason', async () => {
    const onEvict = vi.fn();
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      hooks: { onEvict },
    });
    c.addMessages([makeMsg('user', 'a'), makeMsg('assistant', 'b')]);
    await c.compress({ evictCount: 2 });
    expect(onEvict).toHaveBeenCalledOnce();
    const [evictedMsgs, reason] = onEvict.mock.calls[0];
    expect(evictedMsgs).toHaveLength(2);
    expect(reason).toBe('manual');
  });

  it('onCompress is called with evicted messages, summary, and elapsed ms', async () => {
    const onCompress = vi.fn();
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      hooks: { onCompress },
    });
    c.addMessages([makeMsg('user', 'x'), makeMsg('assistant', 'y')]);
    await c.compress({ evictCount: 2 });
    expect(onCompress).toHaveBeenCalledOnce();
    const [msgs, summary, ms] = onCompress.mock.calls[0];
    expect(msgs).toHaveLength(2);
    expect(typeof summary).toBe('string');
    expect(typeof ms).toBe('number');
  });

  it('onError is called when summarizer throws', async () => {
    const onError = vi.fn();
    const failingSummarizer: SummarizerFn = async () => {
      throw new Error('LLM unavailable');
    };
    const c = createCompressor({
      summarizer: failingSummarizer,
      eviction: { trigger: 'manual' },
      hooks: { onError },
    });
    c.addMessage(makeMsg('user', 'hi'));
    await expect(c.compress({ evictCount: 1 })).rejects.toThrow('LLM unavailable');
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('getMessages()', () => {
  it('prepends summary as system message when present', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
      summaryRole: 'system',
    });
    c.addMessages([makeMsg('user', 'a'), makeMsg('assistant', 'b')]);
    await c.compress({ evictCount: 2 });
    c.addMessage(makeMsg('user', 'follow'));

    const msgs = await c.getMessages();
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toBe('Summary: a; b');
    expect(msgs[msgs.length - 1].content).toBe('follow');
  });

  it('does not prepend summary message when summary is null', async () => {
    const c = createCompressor({ summarizer: mockSummarizer, eviction: { trigger: 'manual' } });
    c.addMessage(makeMsg('user', 'hello'));
    const msgs = await c.getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });
});

describe('resetStats()', () => {
  it('zeros all stats fields', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      eviction: { trigger: 'manual' },
      mergeStrategy: 'replace',
    });
    c.addMessages([makeMsg('user', 'a'), makeMsg('assistant', 'b')]);
    await c.compress({ evictCount: 2 });
    c.resetStats();
    const stats = c.getStats();
    expect(stats.totalMessages).toBe(0);
    expect(stats.messagesCompressed).toBe(0);
    expect(stats.summarizationCalls).toBe(0);
    expect(stats.compressionRatio).toBe(0);
  });
});

describe('combined eviction trigger', () => {
  it('fires when either threshold exceeded', async () => {
    const c = createCompressor({
      summarizer: mockSummarizer,
      mergeStrategy: 'replace',
      eviction: {
        trigger: 'combined',
        tokenThreshold: 10000, // high — won't trigger
        tokenTarget: 5000,
        messageThreshold: 3, // low — will trigger
        messageTarget: 1,
      },
    });
    c.addMessages([makeMsg('user', 'a'), makeMsg('assistant', 'b'), makeMsg('user', 'c')]);
    const result = await c.getCompressed();
    expect(result.summary).not.toBeNull();
  });
});
