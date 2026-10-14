import UnoCSS from 'unocss/vite';
import type { UserConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const config: UserConfig = defineConfig({
  build: {
    target: 'esnext',
  },
  // https://github.com/andi23rosca/solid-markdown/issues/33
  optimizeDeps: {
    include: ['solid-markdown > micromark', 'solid-markdown > unified'],
  },
  plugins: [UnoCSS(), solidPlugin()],
  resolve: { tsconfigPaths: true },
  server: {
    port: 3000,
  },
  test: {
    environment: 'node',
  },
});

export default config;
