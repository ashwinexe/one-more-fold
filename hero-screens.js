import { buildHalo, createHaloAnimator, PROFILE_HALO_CONFIG, HALO_INSET } from './voice-halo.js';

const loadImage = src => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = reject;
  image.src = src;
});
const canvas = (width, height = width) => Object.assign(document.createElement('canvas'), { width, height });

async function init() {
  const [open, closed, bust] = await Promise.all([
    loadImage('/voice-design-open.png'), loadImage('/voice-design-closed.png'), loadImage('/assets/hero-bust.webp'),
  ]);
  const size = 512;
  // The website's optimized WebP has a black matte. Remove only dark pixels
  // connected to the image edge, preserving shadows within the sculpture.
  const figure = canvas(bust.width, bust.height);
  const figureContext = figure.getContext('2d');
  figureContext.drawImage(bust, 0, 0);
  const pixels = figureContext.getImageData(0, 0, bust.width, bust.height);
  const visited = new Uint8Array(bust.width * bust.height);
  const queue = [];
  function add(x, y) {
    if (x < 0 || y < 0 || x >= bust.width || y >= bust.height) return;
    const index = y * bust.width + x;
    if (visited[index]) return;
    visited[index] = 1;
    const p = index * 4;
    const brightness = Math.max(pixels.data[p], pixels.data[p + 1], pixels.data[p + 2]);
    if (brightness > 45) return;
    pixels.data[p + 3] = Math.round(255 * Math.max(0, (brightness - 12) / 33));
    queue.push([x, y]);
  }
  for (let x = 0; x < bust.width; x++) { add(x, 0); add(x, bust.height - 1); }
  for (let y = 0; y < bust.height; y++) { add(0, y); add(bust.width - 1, y); }
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    add(x - 1, y); add(x + 1, y); add(x, y - 1); add(x, y + 1);
  }
  figureContext.putImageData(pixels, 0, 0);
  figureContext.globalCompositeOperation = 'destination-in';
  const fade = figureContext.createLinearGradient(0, 0, 0, bust.height);
  fade.addColorStop(0, '#fff'); fade.addColorStop(0.72, '#fff'); fade.addColorStop(1, '#fff0');
  figureContext.fillStyle = fade;
  figureContext.fillRect(0, 0, bust.width, bust.height);
  const back = canvas(size), front = canvas(size);
  // Keep the upper arc behind the head; the lower arc crosses the torso.
  // Split by projected height so moving particles keep the same occlusion.
  const behind = (_particle, projected, geo) => projected.y < geo.pixels * 0.55;
  const ahead = (particle, projected, geo) => !behind(particle, projected, geo);
  // One geometry and clock keep the complementary layers together.
  const geometry = buildHalo(1337, size * HALO_INSET, {
    ...PROFILE_HALO_CONFIG, palette: ['#d77c50', '#a95737'],
    compositeOperation: 'source-over', glowCap: 0.15,
  });
  const animator = createHaloAnimator({
    geometry, targets: [{ canvas: back, filter: behind }, { canvas: front, filter: ahead }],
    state: 'waiting', speed: 0.2, manual: true, pauseOffscreen: false, reducedMotion: false,
  });
  const layouts = {
    inner: { image: open, clear: [300, 90, 180, 230], sample: 290, figure: [329, 126, 120, 163], halo: [279, 103, 220, 200] },
    outer: { image: closed, clear: [155, 88, 171, 220], sample: 145, figure: [181, 113, 119, 162], halo: [130, 92, 220, 200] },
  };
  const screens = {};
  for (const [key, layout] of Object.entries(layouts)) {
    const base = canvas(layout.image.width, layout.image.height);
    const ctx = base.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(layout.image, 0, 0);
    // Flatten the captured near-black gradient to one neutral background.
    // The phone shader quantizes that gradient into visible horizontal bands.
    // Ease out through shadow tones so statue edges and text stay intact.
    const background = ctx.getImageData(0, 0, base.width, base.height);
    const rgba = background.data;
    for (let i = 0; i < rgba.length; i += 4) {
      const high = Math.max(rgba[i], rgba[i + 1], rgba[i + 2]);
      const low = Math.min(rgba[i], rgba[i + 1], rgba[i + 2]);
      if (high >= 52 || high - low > 16) continue;
      const t = Math.max(0, Math.min(1, (high - 28) / 24));
      const amount = 1 - t * t * (3 - 2 * t);
      for (let channel = 0; channel < 3; channel++) {
        rgba[i + channel] = Math.round(rgba[i + channel] + (16 - rgba[i + channel]) * amount);
      }
    }
    ctx.putImageData(background, 0, 0);
    // Replace the captured figure and frozen halo with the same background
    // gradient sampled alongside them. Keep all website text and neighbours.
    const [x, y, width, height] = layout.clear;
    const gradient = ctx.getImageData(layout.sample, y, 1, height).data;
    for (let row = 0; row < height; row++) {
      const offset = row * 4;
      ctx.fillStyle = `rgb(${gradient[offset]} ${gradient[offset + 1]} ${gradient[offset + 2]})`;
      ctx.fillRect(x, y + row, width, 1);
    }
    layout.base = base;
    screens[key] = canvas(base.width, base.height);
    layout.ctx = screens[key].getContext('2d');
  }
  window.__voiceDesignScreens = screens;
  const audio = document.querySelector('audio');
  let context, analyser, samples;
  audio?.addEventListener('play', () => {
    if (!context) {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaElementSource(audio).connect(analyser);
      analyser.connect(context.destination);
      samples = new Uint8Array(analyser.fftSize);
      animator.setLevel(() => {
        analyser.getByteTimeDomainData(samples);
        const energy = samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0);
        return Math.min(1, Math.sqrt(energy / samples.length) * 3);
      });
    }
    context.resume().catch(() => {});
    animator.setState('speaking');
    animator.pulse();
  });
  ['pause', 'ended'].forEach(event => audio?.addEventListener(event, () => animator.setState('waiting')));
  let last = 0, frames = 0;
  function frame(time) {
    requestAnimationFrame(frame);
    if (document.hidden || time - last < 1000 / 30) return;
    animator.step(last ? Math.min((time - last) / 1000, 0.1) : 1 / 30);
    last = time;
    for (const layout of Object.values(layouts)) {
      const ctx = layout.ctx;
      ctx.drawImage(layout.base, 0, 0);
      ctx.drawImage(back, ...layout.halo);
      ctx.filter = 'brightness(0.82)';
      ctx.drawImage(figure, ...layout.figure);
      ctx.filter = 'none';
      ctx.drawImage(front, ...layout.halo);
    }
    document.body.dataset.haloFrames = String(++frames);
    window.__voiceDesignInvalidate?.();
  }
  requestAnimationFrame(frame);
}
init().catch(error => console.error('Animated hero could not load; keeping screen captures.', error));
