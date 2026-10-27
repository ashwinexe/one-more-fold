import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';

test('serve the built demo and reject unknown paths without a proxy', async () => {
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '0' } });
  try {
    const [output] = await once(child.stdout, 'data');
    const origin = String(output).match(/http:\/\/127\.0\.0\.1:\d+/)[0];
    for (const name of ['/', '/exact.html', '/halo-preview.html', '/apple-main.js', '/fold-playback.js', '/phonon-speech.js', '/hero-screens.js', '/vendor/phonon-tts/index.js', '/assets/keynote-voice.safetensors', '/v/iphone-duo/a/static/scenes/iPhoneDuo_US_L_avif.lsd']) {
      const response = await fetch(origin + name);
      assert.equal(response.status, 200, name);
    }
    for (const name of ['/in/shop/buy-mac/studio-display?option=large', '/in/legal/more-resources/docs/India-RoHS-Compliance.pdf', '/tw/business/docs/large.pdf', '/assets/missing.pdf', '/v/iphone-duo/a/static/missing.lsd', '/server.mjs', '/.git/config', '/%2e%2e%2fpackage.json', '/vendor/phonon-tts/missing.js']) {
      const response = await fetch(origin + name);
      assert.equal(response.status, 404, name);
      assert.equal(await response.text(), 'Not found', name);
    }
    assert.equal((await fetch(origin, { method: 'HEAD' })).status, 200);
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  } finally {
    child.kill();
    await once(child, 'exit');
  }
});

test('deployment has no upstream route and the page contains only the demo link', async () => {
  const config = JSON.parse(await fs.readFile('vercel.json', 'utf8'));
  assert.deepEqual(config.routes, [{ src: '/', dest: '/exact.html' }, { handle: 'filesystem' }, { src: '/(.*)', status: 404 }]);
  const html = await fs.readFile('public/exact.html', 'utf8');
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links, ['https://gradium.ai/phonon']);
  assert.doesNotMatch(html, /globalnav|ac-globalfooter|application\/ld\+json|rel="alternate"/);
});

test('bundled scene and glTF references resolve to local files', async () => {
  const path = await import('node:path');
  const files = await fs.readdir('viewer-assets', { recursive: true });
  let references = 0;
  for (const file of files.filter(file => /\.(lsd|gltf)$/.test(file))) {
    const json = JSON.parse(await fs.readFile(path.join('viewer-assets', file), 'utf8'));
    async function walk(value, key) {
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) await walk(child, key);
      } else if (typeof value === 'string' && (value.startsWith('/uploads/') || key === 'uri') && !value.startsWith('data:')) {
        const url = value.startsWith('/uploads/') ? '/v/iphone-duo/a/static' + value : new URL(value, 'https://local/' + file).pathname;
        await fs.access(path.join('public', url));
        references++;
      }
    }
    await walk(json);
  }
  assert.ok(references > 100);
});
