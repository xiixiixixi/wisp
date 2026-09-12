import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

// Single source of truth for the app version is apps/src-tauri/tauri.conf.json;
// it is inlined at dev/build time so the About page can show it synchronously.
const tauriVersion = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, 'apps', 'src-tauri', 'tauri.conf.json'),
    'utf8',
  ),
).version as string;

export default defineConfig(({ mode }) => ({
  plugins: [
    react({
      // Optimized dependencies can live outside node_modules when a dev server
      // uses a custom cacheDir. Compiling that cache changes third-party hook
      // order (for example Wouter's router.hook call) on subsequent renders.
      include: [
        path.resolve(import.meta.dirname, 'apps/client/src/**/*.{js,jsx,ts,tsx}'),
        path.resolve(import.meta.dirname, 'packages/*/src/**/*.{js,jsx,ts,tsx}'),
      ],
      ...(mode === 'test'
        ? {}
        : {
            babel: {
              plugins: [['babel-plugin-react-compiler', { target: '19' }]],
            },
          }),
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@',
        replacement: path.resolve(import.meta.dirname, 'apps', 'client', 'src'),
      },
      {
        find: '@wisp/sdk',
        replacement: path.resolve(import.meta.dirname, 'packages', 'sdk', 'src', 'index.ts'),
      },
      {
        find: '@wisp/extension-sdk',
        replacement: path.resolve(
          import.meta.dirname,
          'packages',
          'extension-sdk',
          'src',
          'index.ts',
        ),
      },
    ],
  },
  root: path.resolve(import.meta.dirname, 'apps', 'client'),
  optimizeDeps: {
    // pdfjs-dist must stay unbundled so the JSC patch plugin below can
    // rewrite its readonly-prototype assignment. react-pdf stays optimized:
    // served unbundled, its dist files form an import cycle that dies with
    // "Cannot access 'default' before initialization" in the browser.
    exclude: ['pdfjs-dist'],
    include: ['react-pdf'],
  },
  define: {
    __APP_VERSION__: JSON.stringify(tauriVersion),
  },
  build: {
    outDir: path.resolve(import.meta.dirname, 'apps/client/dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.includes('pdf.worker')) {
            return 'assets/pdf.worker.[hash][extname]';
          }
          return 'assets/[name].[hash][extname]';
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    watch: {
      ignored: ['**/packages/extensions/**'],
    },
  },
  // Copy PDF worker to public directory
  assetsInclude: ['**/*.wasm'],
  // Tauri expects a fixed port, fail if that port is not available
  clearScreen: false,
  // Env variables starting with VITE_ will be exposed to the client
  envPrefix: ['VITE_', 'TAURI_'],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.{test,spec}.{ts,tsx}'],
    define: {
      'import.meta.env.TAURI_FAMILY': '"test"',
      'window.__TAURI__': 'undefined',
      __APP_VERSION__: JSON.stringify(tauriVersion),
    },
  },
}));
