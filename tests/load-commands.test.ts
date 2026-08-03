import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  loadCommands,
  WhaNextError,
  type CommandDefinition,
} from '@/index.js';

class FakeRegistrar {
  readonly registered: CommandDefinition[] = [];

  command(definition: CommandDefinition): this {
    this.registered.push(definition);
    return this;
  }
}

describe('loadCommands', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'whanext-commands-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('registers default-exported commands from js files', async () => {
    await writeFile(
      path.join(dir, 'ping.mjs'),
      "export default { name: 'ping', description: 'ping', execute: () => {} };",
    );

    const registrar = new FakeRegistrar();
    const result = await loadCommands(registrar, dir);

    expect(registrar.registered.map((command) => command.name)).toEqual(['ping']);
    expect(result.loaded).toHaveLength(1);
  });

  it('registers named-exported commands when there is no default export', async () => {
    await writeFile(
      path.join(dir, 'ban.mjs'),
      "export const banCommand = { name: 'ban', description: 'ban', execute: () => {} };",
    );

    const registrar = new FakeRegistrar();
    await loadCommands(registrar, dir);

    expect(registrar.registered.map((command) => command.name)).toEqual(['ban']);
  });

  it('registers every named command exported by the same file', async () => {
    await writeFile(
      path.join(dir, 'moderation.mjs'),
      [
        "export const mute = { name: 'mute', description: 'mute', execute: () => {} };",
        "export const unmute = { name: 'unmute', description: 'unmute', execute: () => {} };",
      ].join('\n'),
    );

    const registrar = new FakeRegistrar();
    const result = await loadCommands(registrar, dir);

    expect(registrar.registered.map((command) => command.name)).toEqual(['mute', 'unmute']);
    expect(result.loaded).toEqual([path.join(dir, 'moderation.mjs')]);
    expect(result.commands).toEqual([
      { name: 'mute', filePath: path.join(dir, 'moderation.mjs') },
      { name: 'unmute', filePath: path.join(dir, 'moderation.mjs') },
    ]);
  });

  it('registers a default-exported command collection', async () => {
    await writeFile(
      path.join(dir, 'moderation.mjs'),
      [
        "const mute = { name: 'mute', description: 'mute', execute: () => {} };",
        "const unmute = { name: 'unmute', description: 'unmute', execute: () => {} };",
        'export default [mute, unmute];',
      ].join('\n'),
    );

    const registrar = new FakeRegistrar();
    await loadCommands(registrar, dir);

    expect(registrar.registered.map((command) => command.name)).toEqual(['mute', 'unmute']);
  });

  it('registers command groups that contain subcommands', async () => {
    await writeFile(
      path.join(dir, 'group.mjs'),
      [
        "const close = { name: 'close', description: 'close', execute: () => {} };",
        "export default { name: 'group', description: 'group', subcommands: [close] };",
      ].join('\n'),
    );

    const registrar = new FakeRegistrar();
    await loadCommands(registrar, dir);

    expect(registrar.registered.map((command) => command.name)).toEqual(['group']);
  });

  it('ignores auxiliary exports when the file contains commands', async () => {
    await writeFile(
      path.join(dir, 'ping.mjs'),
      [
        "export const metadata = { category: 'utility' };",
        "export const ping = { name: 'ping', description: 'ping', execute: () => {} };",
      ].join('\n'),
    );

    const registrar = new FakeRegistrar();
    await loadCommands(registrar, dir);

    expect(registrar.registered.map((command) => command.name)).toEqual(['ping']);
  });

  it('does not register the same command twice when it is re-exported', async () => {
    await writeFile(
      path.join(dir, 'ping.mjs'),
      [
        "const ping = { name: 'ping', description: 'ping', execute: () => {} };",
        'export { ping };',
        'export default [ping];',
      ].join('\n'),
    );

    const registrar = new FakeRegistrar();
    await loadCommands(registrar, dir);

    expect(registrar.registered.map((command) => command.name)).toEqual(['ping']);
  });

  it('loads commands from nested directories by default', async () => {
    await mkdir(path.join(dir, 'moderation'));
    await writeFile(
      path.join(dir, 'moderation', 'kick.mjs'),
      "export default { name: 'kick', description: 'kick', execute: () => {} };",
    );

    const registrar = new FakeRegistrar();
    await loadCommands(registrar, dir);

    expect(registrar.registered.map((command) => command.name)).toEqual(['kick']);
  });

  it('skips files outside the configured extensions', async () => {
    await writeFile(path.join(dir, 'notes.md'), '# not a command');

    const registrar = new FakeRegistrar();
    const result = await loadCommands(registrar, dir);

    expect(registrar.registered).toHaveLength(0);
    expect(result.skipped).toEqual([path.join(dir, 'notes.md')]);
  });

  it('does not load ts files unless explicitly enabled', async () => {
    await writeFile(
      path.join(dir, 'mute.ts'),
      "export default { name: 'mute', description: 'mute', execute: () => {} };",
    );

    const registrar = new FakeRegistrar();
    const result = await loadCommands(registrar, dir);

    expect(registrar.registered).toHaveLength(0);
    expect(result.skipped).toEqual([path.join(dir, 'mute.ts')]);
  });

  it('throws a WhaNextError when a file does not export a valid command', async () => {
    await writeFile(path.join(dir, 'broken.mjs'), 'export default { foo: 1 };');

    const registrar = new FakeRegistrar();

    await expect(loadCommands(registrar, dir)).rejects.toThrow(WhaNextError);
    await expect(loadCommands(registrar, dir)).rejects.toMatchObject({
      code: 'COMMAND_LOAD_FAILED',
    });
  });

  it('throws a WhaNextError when the directory does not exist', async () => {
    const registrar = new FakeRegistrar();

    await expect(loadCommands(registrar, path.join(dir, 'missing'))).rejects.toMatchObject({
      code: 'COMMAND_LOAD_FAILED',
    });
  });
});
