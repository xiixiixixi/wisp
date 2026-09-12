import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer, loadConfigFromFile } from 'vite';

const repository = fileURLToPath(new URL('..', import.meta.url));

test('React Compiler skips external dependency caches and still compiles application controls', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'wisp-react-transform-'));
  const dependency = path.join(temporary, 'deps', 'router.js');
  await mkdir(path.dirname(dependency), { recursive: true });
  await writeFile(
    dependency,
    'export const useDependencyLocation = (router) => { const [location, navigate] = router.hook(router); return [location, navigate]; };',
  );
  let server;
  try {
    const configuration = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      path.join(repository, 'vite.config.ts'),
    );
    server = await createServer({
      ...configuration.config,
      configFile: false,
      plugins: [
        ...configuration.config.plugins,
        {
          name: 'skip-prebundling-in-transform-test',
          configResolved(config) {
            // React adds runtime dependencies to optimizeDeps.include. This
            // test inspects transform output without loading those modules.
            config.optimizeDeps.include = [];
            config.optimizeDeps.noDiscovery = true;
          },
        },
      ],
      mode: 'development',
      cacheDir: path.join(temporary, 'cache'),
      logLevel: 'silent',
      server: {
        middlewareMode: true,
        watch: null,
        hmr: false,
        fs: { allow: [repository, temporary] },
      },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    const external = await server.transformRequest(`/@fs${dependency}`);
    assert.ok(external?.code.includes('router.hook(router)'));
    assert.doesNotMatch(external.code, /compiler.runtime|memo_cache_sentinel|\b_c\(/);

    const application = await server.transformRequest('/src/components/ui/button.tsx');
    assert.match(application.code, /compiler.runtime/);
    assert.match(application.code, /\b_c\(/);
  } finally {
    await server?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
