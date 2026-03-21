import type { Message, EvictionConfig, TokenCounter } from './types.js';
import { countMessageTokens } from './token-counter.js';

function totalTokens(
  messages: Message[],
  counter: TokenCounter,
  overhead: number
): number {
  return messages.reduce((sum, m) => sum + countMessageTokens(m, counter, overhead), 0);
}

export function shouldEvict(
  messages: Message[],
  _summary: string | null,
  eviction: EvictionConfig,
  counter: TokenCounter,
  overhead: number
): boolean {
  if (eviction.trigger === 'manual') return false;

  if (eviction.trigger === 'messages') {
    return messages.length >= eviction.threshold;
  }

  if (eviction.trigger === 'tokens') {
    return totalTokens(messages, counter, overhead) >= eviction.threshold;
  }

  if (eviction.trigger === 'combined') {
    const overMessages = messages.length >= eviction.messageThreshold;
    const overTokens = totalTokens(messages, counter, overhead) >= eviction.tokenThreshold;
    return overMessages || overTokens;
  }

  return false;
}

export function getEvictionCount(
  messages: Message[],
  _summary: string | null,
  eviction: EvictionConfig,
  counter: TokenCounter,
  overhead: number
): number {
  if (eviction.trigger === 'manual' || messages.length === 0) return 0;

  if (eviction.trigger === 'messages') {
    const count = messages.length - eviction.target;
    return Math.max(1, count);
  }

  if (eviction.trigger === 'tokens') {
    const target = eviction.target;
    let running = totalTokens(messages, counter, overhead);
    let evictCount = 0;
    while (running >= target && evictCount < messages.length) {
      running -= countMessageTokens(messages[evictCount], counter, overhead);
      evictCount++;
    }
    return Math.max(1, evictCount);
  }

  if (eviction.trigger === 'combined') {
    // Compute based on whichever threshold was exceeded, use the one that needs more evictions
    let countByMessages = 0;
    if (messages.length >= eviction.messageThreshold) {
      countByMessages = Math.max(1, messages.length - eviction.messageTarget);
    }

    let countByTokens = 0;
    const total = totalTokens(messages, counter, overhead);
    if (total >= eviction.tokenThreshold) {
      let running = total;
      while (running >= eviction.tokenTarget && countByTokens < messages.length) {
        running -= countMessageTokens(messages[countByTokens], counter, overhead);
        countByTokens++;
      }
      countByTokens = Math.max(1, countByTokens);
    }

    return Math.max(countByMessages, countByTokens);
  }

  return 0;
}

export function getAtomicEvictionGroup(messages: Message[], startIdx: number): number {
  const msg = messages[startIdx];
  if (!msg) return startIdx;

  // If this assistant message has tool_calls, include subsequent tool messages
  if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
    const toolCallIds = new Set(msg.tool_calls.map((tc) => tc.id));
    let endIdx = startIdx;
    for (let i = startIdx + 1; i < messages.length; i++) {
      const next = messages[i];
      if (next.role === 'tool' && next.tool_call_id && toolCallIds.has(next.tool_call_id)) {
        endIdx = i;
      } else {
        break;
      }
    }
    return endIdx;
  }

  return startIdx;
}
