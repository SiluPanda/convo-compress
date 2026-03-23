import type { Message, TokenCounter } from './types.js';

export const defaultTokenCounter: TokenCounter = (text: string): number =>
  Math.ceil(text.length / 4);

export function countMessageTokens(
  msg: Message,
  counter: TokenCounter,
  overhead: number
): number {
  let tokens = counter(msg.content ?? '');
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    tokens += counter(JSON.stringify(msg.tool_calls));
  }
  return tokens + overhead;
}
