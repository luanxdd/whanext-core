import type {
  CommandConcurrency,
  ConcurrencyStrategy,
} from '@/commands/command.js';
import { WhaNextError } from '@/errors/error.js';

interface ExecutionState {
  active: number;
  queue: Array<() => void>;
  controllers: Set<AbortController>;
}

export class CommandConcurrencyController {
  readonly #states = new Map<string, ExecutionState>();

  async run(
    key: string,
    options: CommandConcurrency | undefined,
    execute: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const strategy = options?.strategy ?? 'parallel';
    if (strategy === 'parallel') {
      await execute(new AbortController().signal);
      return;
    }

    const max = Math.max(1, options?.max ?? 1);
    const state = this.#states.get(key) ?? { active: 0, queue: [], controllers: new Set() };
    this.#states.set(key, state);

    if (strategy === 'replace') {
      for (const controller of state.controllers) controller.abort();
      state.controllers.clear();
    } else if (strategy === 'reject' && state.active >= max) {
      throw new WhaNextError('COMMAND_BUSY', 'This command is already running.', {
        context: { key, max },
        recoverable: true,
      });
    } else if (strategy === 'queue' && state.active >= max) {
      await new Promise<void>((resolve) => state.queue.push(resolve));
    }

    const controller = new AbortController();
    state.controllers.add(controller);
    state.active += 1;

    try {
      await execute(controller.signal);
    } finally {
      state.controllers.delete(controller);
      state.active -= 1;
      state.queue.shift()?.();

      if (state.active === 0 && state.queue.length === 0) {
        this.#states.delete(key);
      }
    }
  }
}

export function normalizeConcurrencyStrategy(
  strategy: ConcurrencyStrategy | undefined,
): ConcurrencyStrategy {
  return strategy ?? 'parallel';
}
