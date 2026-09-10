# One More Fold

Gradium Voice Design, folded into an iPhone Duo demo.

```bash
node server.mjs
```

Open http://127.0.0.1:4323/?enhanced=&enhanced-rt=.

The phone opens and closes once. Drag the slider or the model to take over. Press Space or the play button for a synthetic keynote introduction; press again during speech to pause. The intro is an original designed voice, not a recording of an Apple presenter.

This is a recording prototype. The screens combine captures of [Gradium Voice Design](https://gradium.ai/voice-design) with an animated particle halo around the hero figure. The halo reacts to narration and keeps moving when the fold stops. The phone viewer loads additional assets from Apple at runtime, so an internet connection is required. It is not an official Apple product page.

The standalone `voice-halo.js` module was supplied by Aïna. `hero-screens.js` composes its two synchronized layers around the original figure and feeds both screens into the phone renderer. `/halo-preview.html` shows those compositions at full size for visual checks. Recording mode keeps the halo animated; it pauses when the tab is hidden.

Run `bun run check` for syntax checks. The three additional keynote takes are still pending WAV import; the clip list currently contains the introduction only.

Apple viewer code and imagery, and Gradium branding, remain the property of their respective owners. No blanket open-source license is granted for those assets.
