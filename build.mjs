import fs from 'node:fs/promises';
await fs.rm('public', { recursive: true, force: true });
await fs.mkdir('public', { recursive: true });
const files = ['exact.html','apple-main.js','fold-playback.js','hero-screens.js','halo-preview.html'];
for (const file of files) await fs.copyFile(file, 'public/' + file);
await fs.cp('assets', 'public/assets', { recursive: true });
