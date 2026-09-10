import fs from 'node:fs/promises';
await fs.rm('public', { recursive: true, force: true });
await fs.mkdir('public', { recursive: true });
const files = ['exact.html','apple-main.js','fold-playback.js','hero-screens.js','voice-halo.js','keynote-clips.json','keynote-intro.wav','voice-design-open.png','voice-design-closed.png'];
for (const file of files) await fs.copyFile(file, 'public/' + file);
await fs.cp('assets', 'public/assets', { recursive: true });
