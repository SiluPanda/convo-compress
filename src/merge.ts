import type { MergeStrategy, SummarizerFn, CustomMergeFn, Message } from './types.js';
import { defaultMergePrompt } from './prompts.js';

export async function mergeSummaries(
  oldSummary: string | null,
  newSummary: string,
  strategy: MergeStrategy,
  options: {
    summarizer?: SummarizerFn;
    customMerge?: CustomMergeFn;
    separator?: string;
  }
): Promise<string> {
  const separator = options.separator ?? '\n\n';

  switch (strategy) {
    case 'replace':
      return newSummary;

    case 'append':
      return oldSummary ? oldSummary + separator + newSummary : newSummary;

    case 'weighted': {
      if (!oldSummary) return newSummary;
      const content = `${defaultMergePrompt}\n\n[Previous Summary]\n${oldSummary}\n\n[Recent Summary]\n${newSummary}`;
      const msgs: Message[] = [{ role: 'user', content }];
      if (!options.summarizer) {
        return oldSummary + separator + newSummary;
      }
      return options.summarizer(msgs);
    }

    case 'summarize': {
      if (!oldSummary) return newSummary;
      const content = `${defaultMergePrompt}\n\n[Previous Summary]\n${oldSummary}\n\n[New Summary]\n${newSummary}`;
      const msgs: Message[] = [{ role: 'user', content }];
      if (!options.summarizer) {
        return oldSummary + separator + newSummary;
      }
      return options.summarizer(msgs);
    }

    case 'custom': {
      if (!options.customMerge) {
        return oldSummary ? oldSummary + separator + newSummary : newSummary;
      }
      return options.customMerge(oldSummary, newSummary);
    }

    default:
      return oldSummary ? oldSummary + separator + newSummary : newSummary;
  }
}
