import { createSpeech } from './phonon-speech.js';

const slider = document.getElementById('fold-control');
const controls = document.getElementById('fold-controls');
const ground = document.getElementById('floating-ground');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const play = document.createElement('button');
play.type = 'button';
play.disabled = true;
play.style.cssText = 'position:absolute;right:-44px;top:50%;transform:translateY(-50%);width:36px;height:36px;border:0;border-radius:50%;background:#1c1d20;color:#f5f5f5;cursor:pointer;font-size:14px;transition:background .2s,box-shadow .2s';
controls.append(play);
const status = document.createElement('div');
status.setAttribute('role', 'status');
status.style.cssText = 'position:absolute;bottom:34px;left:50%;transform:translateX(-50%);width:min(360px,85vw);text-align:center;font:12px/1.4 system-ui,sans-serif;color:#6e6e73;pointer-events:none';
controls.append(status);
const narration = createSpeech({
  onStatus: text => { status.textContent = text; },
  onStart: () => {
    start = performance.now();
    automated = !reducedMotion.matches;
    updateButton();
  },
  onEnd: () => { stopMotion(); },
});

let scene = null;
let start = null;
let automated = false;
let scrubbing = false;
let request = 0;
function updateButton() {
  const playing = narration.active;
  play.textContent = playing ? 'Ⅱ' : '▶';
  play.setAttribute('aria-label', playing ? 'Stop Phonon narration' : 'Play Phonon narration');
  play.title = playing ? 'Stop (Space)' : 'Play Phonon narration (Space)';
  play.setAttribute('aria-pressed', String(playing));
  play.style.background = playing ? '#36383d' : '#1c1d20';
  play.style.boxShadow = playing ? '0 0 0 5px #11111120' : 'none';
}
updateButton();

function stopMotion(stopSpeech = true) {
  request++;
  automated = false;
  if (stopSpeech) narration.stop();
  scene?.onSliderInactive();
  updateButton();
}

function setFold(value) {
  if (!scene) return;
  scene.onSliderActive();
  scene.onSliderUpdate({ gestureProgress: value, pointer: true, isClick: false });
  slider.value = value;
}

function togglePlayback() {
  if (!scene) return;
  const wasPlaying = narration.active;
  stopMotion();
  if (!wasPlaying) {
    void narration.play();
    updateButton();
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
window.addEventListener('pagehide', () => stopMotion());

const ready = setInterval(() => {
  if (!window.__duoScene?.hinge) return;
  clearInterval(ready);
  scene = window.__duoScene;
  automated = !reducedMotion.matches && request === 0;
  updateButton();
  controls.style.opacity = '1';
  ground.style.opacity = '1';
  play.disabled = false;
  requestAnimationFrame(loop);
}, 100);

function loop(time) {
  if (start === null) start = time;
  if (automated) {
    const elapsed = time - start;
    let value = elapsed < 1800 ? 0 : elapsed < 6000 ? (elapsed - 1800) / 4200 : elapsed < 8600 ? 1 : elapsed < 12800 ? 1 - (elapsed - 8600) / 4200 : 0;
    setFold(value * value * (3 - 2 * value));
    if (elapsed >= 14000) stopMotion(false);
  } else if (!scrubbing) {
    slider.value = Math.max(0, Math.min(1, scene.hinge.position));
  }
  ground.style.setProperty('--shadow-width', `${28 + 16 * Math.max(0, Math.min(1, scene.hinge.position))}vw`);
  document.body.dataset.sceneState = JSON.stringify({ position: scene.hinge.position, active: scene.hinge.sliderIsActive, automated, scrubbing });
  requestAnimationFrame(loop);
}
