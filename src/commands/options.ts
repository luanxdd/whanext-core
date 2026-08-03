import { ArgsParser } from '@/commands/args-parser.js';
import { WhaNextError } from '@/errors/error.js';
import type { Message } from '@/models/message.js';
import type { User } from '@/models/user.js';
import type { UserService } from '@/services/user-service.js';

interface BaseOption<TKind extends string> {
  kind: TKind;
  description: string;
  required?: boolean;
}

export interface StringOption extends BaseOption<'string'> {
  rest?: boolean;
  minLength?: number;
  maxLength?: number;
}

export interface NumberOption extends BaseOption<'number'> {
  min?: number;
  max?: number;
}

export interface BooleanOption extends BaseOption<'boolean'> {}
export interface UserOption extends BaseOption<'user'> {}
export interface DurationOption extends BaseOption<'duration'> {}

export interface EnumOption<Values extends readonly string[] = readonly string[]>
  extends BaseOption<'enum'> {
  values: Values;
}

export type CommandOptionDefinition =
  | StringOption
  | NumberOption
  | BooleanOption
  | UserOption
  | DurationOption
  | EnumOption;

export type CommandOptionSchema = Readonly<Record<string, CommandOptionDefinition>>;

type RawOptionValue<Definition extends CommandOptionDefinition> =
  Definition extends StringOption ? string
    : Definition extends NumberOption ? number
      : Definition extends BooleanOption ? boolean
        : Definition extends UserOption ? User
          : Definition extends DurationOption ? number | undefined
            : Definition extends EnumOption<infer Values> ? Values[number]
              : never;

export type CommandOptionValue<Definition extends CommandOptionDefinition> =
  Definition['required'] extends true
    ? RawOptionValue<Definition>
    : RawOptionValue<Definition> | undefined;

export type CommandOptionValues<Schema extends CommandOptionSchema> = {
  readonly [Name in keyof Schema]: CommandOptionValue<Schema[Name]>;
};

export const option = {
  string<const Definition extends Omit<StringOption, 'kind'>>(definition: Definition) {
    return { kind: 'string' as const, ...definition };
  },
  number<const Definition extends Omit<NumberOption, 'kind'>>(definition: Definition) {
    return { kind: 'number' as const, ...definition };
  },
  boolean<const Definition extends Omit<BooleanOption, 'kind'>>(definition: Definition) {
    return { kind: 'boolean' as const, ...definition };
  },
  user<const Definition extends Omit<UserOption, 'kind'>>(definition: Definition) {
    return { kind: 'user' as const, ...definition };
  },
  duration<const Definition extends Omit<DurationOption, 'kind'>>(definition: Definition) {
    return { kind: 'duration' as const, ...definition };
  },
  enum<
    const Values extends readonly string[],
    const Definition extends Omit<EnumOption<Values>, 'kind' | 'values'>,
  >(values: Values, definition: Definition) {
    return { kind: 'enum' as const, values, ...definition };
  },
};

export class ParsedCommandOptions<Schema extends CommandOptionSchema = CommandOptionSchema> {
  readonly #values: CommandOptionValues<Schema>;

  constructor(values: CommandOptionValues<Schema>) {
    this.#values = values;
  }

  get<Name extends keyof Schema>(name: Name): CommandOptionValue<Schema[Name]> {
    return this.#values[name];
  }

  string<Name extends keyof Schema>(name: Name): CommandOptionValue<Schema[Name]> {
    return this.get(name);
  }

  number<Name extends keyof Schema>(name: Name): CommandOptionValue<Schema[Name]> {
    return this.get(name);
  }

  boolean<Name extends keyof Schema>(name: Name): CommandOptionValue<Schema[Name]> {
    return this.get(name);
  }

  user<Name extends keyof Schema>(name: Name): CommandOptionValue<Schema[Name]> {
    return this.get(name);
  }

  duration<Name extends keyof Schema>(name: Name): CommandOptionValue<Schema[Name]> {
    return this.get(name);
  }

  enum<Name extends keyof Schema>(name: Name): CommandOptionValue<Schema[Name]> {
    return this.get(name);
  }

  toJSON(): CommandOptionValues<Schema> {
    return { ...this.#values };
  }
}

export async function parseCommandOptions<Schema extends CommandOptionSchema>(
  schema: Schema | undefined,
  tokens: readonly string[],
  message: Message,
  users: UserService,
): Promise<ParsedCommandOptions<Schema>> {
  const args = new ArgsParser(tokens);
  const values: Record<string, unknown> = {};

  for (const [name, definition] of Object.entries(schema ?? {})) {
    const optional = definition.required !== true;

    if (definition.kind === 'user') {
      const hasImplicitUser = message.mentionedUsers.length > 0 || message.quoted?.sender !== undefined;
      if (optional && !hasImplicitUser && args.remaining === 0) {
        values[name] = undefined;
      } else {
        values[name] = await users.resolve(message, args);
      }
      continue;
    }

    const argumentOptions = optional ? { optional: true as const } : undefined;

    if (definition.kind === 'string') {
      const value = definition.rest ? args.rest() : args.string(name, argumentOptions);
      if (definition.required && !value) {
        throw missing(name);
      }
      if (value !== undefined && definition.minLength !== undefined && value.length < definition.minLength) {
        throw invalid(name, value, `at least ${definition.minLength} characters`);
      }
      if (value !== undefined && definition.maxLength !== undefined && value.length > definition.maxLength) {
        throw invalid(name, value, `at most ${definition.maxLength} characters`);
      }
      values[name] = value || undefined;
    } else if (definition.kind === 'number') {
      const value = args.number(name, argumentOptions);
      if (value !== undefined && definition.min !== undefined && value < definition.min) {
        throw invalid(name, value, `at least ${definition.min}`);
      }
      if (value !== undefined && definition.max !== undefined && value > definition.max) {
        throw invalid(name, value, `at most ${definition.max}`);
      }
      values[name] = value;
    } else if (definition.kind === 'boolean') {
      values[name] = args.boolean(name, argumentOptions);
    } else if (definition.kind === 'duration') {
      values[name] = args.duration(name, argumentOptions);
    } else {
      values[name] = args.enum(definition.values, name, argumentOptions);
    }
  }

  if (schema !== undefined && args.remaining > 0) {
    throw new WhaNextError('ARGUMENT_INVALID', 'Too many arguments were provided.', {
      context: { remaining: args.remaining },
    });
  }

  return new ParsedCommandOptions(values as CommandOptionValues<Schema>);
}

function missing(name: string): WhaNextError {
  return new WhaNextError('ARGUMENT_MISSING', `The argument "${name}" is required.`, {
    context: { name },
  });
}

function invalid(name: string, received: unknown, expected: string): WhaNextError {
  return new WhaNextError('ARGUMENT_INVALID', `The argument "${name}" must be ${expected}.`, {
    context: { name, received, expected },
  });
}
