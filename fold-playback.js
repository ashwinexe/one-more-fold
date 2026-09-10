const slider = document.getElementById('fold-control');
const controls = document.getElementById('fold-controls');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const narration = new Audio('/keynote-intro.wav');
narration.preload = 'auto';
narration.hidden = true;
document.body.append(narration);

const play = document.createElement('button');
play.type = 'button';
play.disabled = true;
play.style.cssText = 'position:absolute;right:-44px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;border-radius:50%;background:#f0eeec;color:#be6957;cursor:pointer;font-size:14px;transition:background .2s,box-shadow .2s';
controls.append(play);

let scene = null;
let start = null;
let automated = false;
let scrubbing = false;
let request = 0;
let clips = ['/keynote-intro.wav'];
let lastClip = null;
fetch('/keynote-clips.json').then(response => response.json()).then(available => {
  if (Array.isArray(available) && available.length) clips = available;
}).catch(() => {});

function updateButton() {
  const playing = !narration.paused && !narration.ended;
  play.textContent = playing ? 'Ⅱ' : '▶';
  play.setAttribute('aria-label', playing ? 'Pause narration' : 'Play keynote line');
  play.title = playing ? 'Pause (Space)' : 'Play keynote line (Space)';
  play.style.background = playing ? '#f4e2d9' : '#f0eeec';
  play.style.boxShadow = playing ? '0 0 0 5px #be695714' : 'none';
}
['play', 'pause', 'ended', 'error'].forEach(event => narration.addEventListener(event, updateButton));
updateButton();

function stopMotion() {
  request++;
  automated = false;
  scene?.onSliderInactive();
}

function setFold(value) {
  if (!scene) return;
  scene.onSliderActive();
  scene.onSliderUpdate({ gestureProgress: value, pointer: true, isClick: false });
  slider.value = value;
}

async function togglePlayback() {
  if (!scene) return;
  if (!narration.paused) {
    narration.pause();
    stopMotion();
    return;
  }
  stopMotion();
  const current = request;
  const choices = clips.filter(clip => clip !== lastClip);
  const pool = choices.length ? choices : clips;
  const selected = pool[Math.floor(Math.random() * pool.length)];
  narration.src = selected;
  narration.currentTime = 0;
  try {
    await narration.play();
    lastClip = selected;
    if (current !== request) return;
    start = performance.now();
    automated = !reducedMotion.matches;
  } catch {
    updateButton();
    play.title = 'Audio could not play. Click to retry';
  }
}
play.addEventListener('click', togglePlayback);
document.addEventListener('keydown', event => {
  if (event.code === 'Space' && !event.repeat && !['INPUT', 'BUTTON', 'TEXTAREA'].includes(event.target.tagName)) {
    event.preventDefault();
    togglePlayback();
  }
});

// Release Apple's slider spring before its own model gesture handlers run.
document.addEventListener('pointerdown', event => {
  if (controls.contains(event.target)) return;
  stopMotion();
}, true);
slider.addEventListener('pointerdown', () => { stopMotion(); scrubbing = true; });
slider.addEventListener('input', () => {
  stopMotion();
  scrubbing = true;
  setFold(Number(slider.value));
});
function releaseSlider() {
  if (!scrubbing) return;
  scrubbing = false;
  // Hold the selected pose until a model gesture releases the slider spring.
}
slider.addEventListener('change', releaseSlider);
slider.addEventListener('blur', releaseSlider);
document.addEventListener('pointerup', releaseSlider);
document.addEventListener('pointercancel', releaseSlider);

const ready = setInterval(() => {
  if (!window.__duoScene?.hinge) return;
  clearInterval(ready);
  scene = window.__duoScene;
  automated = !reducedMotion.matches && request === 0;
  controls.style.opacity = '1';
  play.disabled = false;
  requestAnimationFrame(loop);
}, 100);

function loop(time) {
  if (start === null) start = time;
  if (automated) {
    const elapsed = time - start;
    let value = elapsed < 1800 ? 0 : elapsed < 6000 ? (elapsed - 1800) / 4200 : elapsed < 8600 ? 1 : elapsed < 12800 ? 1 - (elapsed - 8600) / 4200 : 0;
    setFold(value * value * (3 - 2 * value));
    if (elapsed >= 14000) stopMotion();
  } else if (!scrubbing) {
    slider.value = Math.max(0, Math.min(1, scene.hinge.position));
  }
  document.body.dataset.sceneState = JSON.stringify({ position: scene.hinge.position, active: scene.hinge.sliderIsActive, automated, scrubbing });
  requestAnimationFrame(loop);
}
