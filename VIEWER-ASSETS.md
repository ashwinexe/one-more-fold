The files in `viewer-assets/` are the Apple viewer stylesheet, head script, Lotus library, and the six large/medium/small AVIF/KTX scene graphs with their referenced resources. They were copied from `https://www.apple.com/v/iphone-duo/a/` on October 27, 2026. Scene paths are preserved. Identical binary assets share one copy, with scene and glTF references updated to match.

`build.mjs` copies these files into `public/`. Builds and page requests never fetch Apple resources. To update the viewer, replace its required files together and verify folding and both displays. Do not add an upstream fallback for missing files.

These assets remain Apple's property under the ownership notice in README.md.
