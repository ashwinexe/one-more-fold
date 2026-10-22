# One More Fold

[Phonon](https://gradium.ai/phonon), folded into an iPhone Duo demo.

![Phonon displayed on a partially unfolded iPhone Duo](assets/demo-preview.png)

```bash
bun run start
```

Open http://127.0.0.1:4323/?enhanced=&enhanced-rt=.

The phone opens and closes once. Drag the slider or the model to take over. Press Space or the play button to replay the fold; press again to pause. Automatic playback respects reduced motion.

This is a silent recording prototype, not an official Apple product page. Both displays show compositions of the Phonon landing page using its original hands and wordmark. The pictured “Click to test” button is part of the screen artwork; use “Try Phonon” to open the working demo. The phone viewer loads additional assets from Apple, so an internet connection is required.

`hero-screens.js` draws the two screen textures. `/halo-preview.html` shows them at full size. Run `bun run check` and `bun run build` before opening a PR.

The hands reproduce Michelangelo’s *Creazione di Adamo*, c. 1511, in the Sistine Chapel, Musei Vaticani. Artwork details are on the [Phonon page](https://gradium.ai/phonon).

Apple viewer code and imagery, and Gradium branding, remain the property of their respective owners. No blanket open-source license is granted for those assets.
