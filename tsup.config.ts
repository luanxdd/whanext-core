import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  target: 'node22',
  external: [
    'zapo-js',
    '@zapo-js/store-sqlite',
    '@zapo-js/media-utils',
  ],
});
