// Compose the Phonon landing-page hero for the phone's two displays.
const loadImage = src => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Could not load ${src}`));
  image.src = src;
});

async function init() {
  const [hands, wordmark, logo] = await Promise.all([
    loadImage('/assets/phonon-hands.webp'),
    loadImage('/assets/phonon-wordmark.webp'),
    loadImage('/assets/gradium-logo.svg'),
  ]);
  const screens = {};
  for (const [key, width, height] of [['inner', 1560, 1120], ['outer', 960, 1380]]) {
    const screen = Object.assign(document.createElement('canvas'), { width, height });
    const ctx = screen.getContext('2d');
    const narrow = key === 'outer';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(logo, 54, 64, 214, 47);
    ctx.font = '22px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#aaa';
    ctx.fillText(narrow ? '☰' : 'Products     Pricing     Blog     Resources', width - 54, 96);

    // Crop each hand separately, leaving the centre clear for the wordmark.
    const handWidth = narrow ? 405 : 440;
    const handY = narrow ? 330 : 410;
    ctx.drawImage(hands, 0, 180, 750, 500, -40, handY, handWidth, handWidth * 2 / 3);
    ctx.drawImage(hands, 900, 180, 700, 500, width - handWidth + 40, handY + 70, handWidth, handWidth * 5 / 7);

    const titleY = narrow ? 680 : 420;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#aaa';
    ctx.font = '22px monospace';
    ctx.fillText('I N T R O D U C I N G', width / 2, titleY - 38);
    const wordWidth = narrow ? 800 : 820;
    // The source wordmark includes the trailing dots and extra right margin.
    ctx.drawImage(wordmark, (width - wordWidth) / 2 + 60, titleY, wordWidth, wordWidth * 381 / 1800);
    ctx.fillStyle = '#a4a4a4';
    ctx.font = '25px monospace';
    const lines = narrow
      ? ["Gradium's open-weight text-to-speech,", 'small enough to ship in any app.', 'Private, and it works offline.']
      : ["Gradium's open-weight text-to-speech, small enough to", 'ship in any app. Private, and it works offline.'];
    const copyY = titleY + (narrow ? 230 : 240);
    lines.forEach((line, index) => ctx.fillText(line, width / 2, copyY + index * 40));
    const buttonY = copyY + lines.length * 40 + 45;
    ctx.fillStyle = '#eee';
    ctx.fillRect(width / 2 - 130, buttonY, 260, 68);
    ctx.fillStyle = '#111';
    ctx.font = '24px monospace';
    ctx.fillText('Click to test', width / 2, buttonY + 42);
    ctx.fillStyle = '#777';
    ctx.font = '21px monospace';
    ctx.fillText('gradium.ai/phonon', width / 2, height - 65);
    screens[key] = screen;
  }
  window.__phononScreens = screens;
  window.__phononInvalidate?.();
}
init().catch(error => console.error('Phonon screens could not load.', error));
