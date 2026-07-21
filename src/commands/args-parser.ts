import { WhaNextError } from '@/errors/error.js';
import { User } from '@/models/user.js';

export interface ArgumentOptions {
  optional?: boolean;
}

export class ArgsParser {
  readonly #values: string[];
  #cursor = 0;

  constructor(values: readonly string[]) {
    this.#values = [...values];
  }

  get remaining(): number {
    return this.#values.length - this.#cursor;
  }

  peek(): string | undefined {
    return this.#values[this.#cursor];
  }

  skip(count = 1): this {
    this.#cursor = Math.min(this.#values.length, this.#cursor + Math.max(0, count));
    return this;
  }

  string(name = 'argument', options: ArgumentOptions = {}): string | undefined {
    return this.#consume(name, options);
  }

  number(name = 'number', options: ArgumentOptions = {}): number | undefined {
    const raw = this.#consume(name, options);

    if (raw === undefined) {
      return undefined;
    }

    const value = Number(raw);

    if (!Number.isFinite(value)) {
      throw new WhaNextError('ARGUMENT_INVALID', `The argument "${name}" must be a number.`, {
        context: { name, received: raw },
      });
    }

    return value;
  }

  boolean(name = 'boolean', options: ArgumentOptions = {}): boolean | undefined {
    const raw = this.#consume(name, options);

    if (raw === undefined) {
      return undefined;
    }

    const normalized = raw.toLowerCase();
    const truthy = new Set(['true', 'on', 'yes', 'sim', '1']);
    const falsy = new Set(['false', 'off', 'no', 'não', 'nao', '0']);

    if (truthy.has(normalized)) {
      return true;
    }

    if (falsy.has(normalized)) {
      return false;
    }

    throw new WhaNextError('ARGUMENT_INVALID', `The argument "${name}" must be a boolean.`, {
      context: { name, received: raw },
    });
  }

  enum<const Values extends readonly string[]>(
    values: Values,
    name = 'option',
    options: ArgumentOptions = {},
  ): Values[number] | undefined {
    const raw = this.#consume(name, options);

    if (raw === undefined) {
      return undefined;
    }

    if (!values.includes(raw)) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        `The argument "${name}" must be one of: ${values.join(', ')}.`,
        {
          context: { name, received: raw, expected: values },
        },
      );
    }

    return raw as Values[number];
  }

  user(name?: string): User;
  user(name: string, options: { optional: true }): User | undefined;
  user(name = 'user', options: ArgumentOptions = {}): User | undefined {
    const raw = this.#consume(name, options);

    if (raw === undefined) {
      return undefined;
    }

    const normalized = raw.replace(/^@/, '').replace(/\D/g, '');

    if (normalized.length < 8) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        `The argument "${name}" must be a mention or phone number.`,
        {
          context: { name, received: raw },
        },
      );
    }

    return User.fromPhoneNumber(normalized);
  }

  duration(name = 'duration', options: ArgumentOptions = {}): number | undefined {
    const raw = this.#consume(name, options);

    if (raw === undefined) {
      return undefined;
    }

    const normalized = raw.toLowerCase();
    const permanent = new Set([
      'forever',
      'indefinido',
      'permanent',
      'permanente',
      'sempre',
    ]);

    if (permanent.has(normalized)) {
      return undefined;
    }

    const match = /^(\d+)(ms|s|m|h|d)$/.exec(normalized);

    if (!match) {
      throw new WhaNextError(
        'ARGUMENT_INVALID',
        `The argument "${name}" must be a duration such as 30s or 5m.`,
        {
          context: { name, received: raw },
        },
      );
    }

    const amount = Number(match[1]);
    const unit = match[2] as 'ms' | 's' | 'm' | 'h' | 'd';
    const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
    return amount * multiplier;
  }

  rest(): string {
    const value = this.#values.slice(this.#cursor).join(' ');
    this.#cursor = this.#values.length;
    return value;
  }

  #consume(name: string, options: ArgumentOptions): string | undefined {
    const value = this.#values[this.#cursor];

    if (value === undefined) {
      if (options.optional) {
        return undefined;
      }

      throw new WhaNextError('ARGUMENT_MISSING', `The argument "${name}" is required.`, {
        context: { name, position: this.#cursor },
      });
    }

    this.#cursor += 1;
    return value;
  }
}
