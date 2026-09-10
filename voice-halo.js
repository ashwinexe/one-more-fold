/**
 * voice-halo.js — the Gradium voice-design hero particle ring, standalone.
 *
 * Extracted verbatim from the Studio sources so the maths matches the shipping
 * hero term for term:
 *   src/lib/voiceHalo.ts          → geometry, palette, projection
 *   src/lib/voiceHaloMotion.ts    → paint, ticker, animator
 *   src/lib/components/VoiceHalo.svelte → the mount/sizing wrapper (mountVoiceHalo)
 *
 * Plain ES module. No Svelte, no TypeScript, no three.js, no GSAP, no build
 * step — drop it next to an HTML file and `import`.
 *
 *   import { mountVoiceHalo, PROFILE_HALO_CONFIG } from './voice-halo.js';
 *   const halo = mountVoiceHalo(document.querySelector('#hero'), {
 *     id: 'whatever',            // or seed: 12345
 *     size: 400,
 *     config: PROFILE_HALO_CONFIG,
 *     state: 'waiting',          // static | waiting | speaking | starting
 *     supersample: 2
 *   });
 *   halo.pulse();
 *   halo.destroy();
 */

// ===========================================================================
// Geometry (from voiceHalo.ts)
// ===========================================================================

/** The generator's fixed canvas, kept so the geometry constants carry over. */
const CANVAS = 1200;
const MARGIN = 200;
/** R in geometry.js: 0.42 * min(box) * zoom. */
const R = 0.42 * (CANVAS - 2 * MARGIN);
/** Focal length in project3DWithAngles. */
const FOCAL = 1200;

/**
 * The most shades one halo may wear. Two, as the website draws them — a ring
 * carrying three or four reads as confetti rather than as a colour.
 */
export const MAX_HALO_COLORS = 2;

/** js/settings.js PALETTE_PRESETS. */
export const PALETTE = [
	'#DAFF52',
	'#1CA0FF',
	'#FFB592',
	'#D895FF',
	'#FF95E5',
	'#60E21A',
	'#AED2FF',
	'#91FFFA'
];

/**
 * The palette in four families of two. Pairs are neighbours around the colour
 * wheel, so a halo reads as one colour with depth in it rather than as two
 * colours fighting.
 */
export const HALO_PAIRS = [
	['#DAFF52', '#60E21A'], // limes
	['#91FFFA', '#1CA0FF'], // cyans
	['#AED2FF', '#D895FF'], // cool blues into violet
	['#FF95E5', '#FFB592'] // warm pinks into peach
];

/** A halo with the colour taken out of it: three greys, dark to light. */
export const DORMANT_PALETTE = ['#4b5563', '#9ca3af', '#d1d5db'];

/**
 * The studio's default. `dotCount` and `dotSize` are the generator's "points"
 * and "weight". (`points` below is a different thing: the 20 control points of
 * the ring's spline.)
 */
export const DEFAULT_HALO_CONFIG = {
	points: 20,
	rMin: 0.6,
	rMax: 1.2,
	smoothness: 0.6,
	dotSize: 2.5,
	dotCount: 3000,
	tubeThickness: 1.0,
	twist: 0.4,
	colorCount: 2,
	paletteOffset: 0
};

/**
 * The halo as a voice's *profile picture* — this is what the voice-design hero
 * wears. Finer and denser than the default, which is tuned for a 15px chip.
 */
export const PROFILE_HALO_CONFIG = { dotSize: 0.8, dotCount: 24000 };

/** Cheaper supersampling than a still avatar's, for several animating at once. */
export const PROFILE_HALO_SUPERSAMPLE = 2;

const lerp = (a, b, t) => a + (b - a) * t;

/** mulberry32 — small, fast, and stable across sessions. */
function rng(seed) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		range: (min, max) => min + next() * (max - min),
		/** Box–Muller, standing in for p5's randomGaussian(0, 1). */
		gaussian: () => {
			const u = 1 - next();
			const v = next();
			return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
		}
	};
}

/** buildVoiceProfileControlPoints. */
function controlPointsFor(rand, config) {
	const n = Math.max(3, Math.floor(config.points));
	const rMin = R * config.rMin;
	const rMax = R * config.rMax;

	let pts = [];
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		const r = rMin + rand.next() * Math.max(0, rMax - rMin);
		pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
	}

	const onePass = (src) =>
		src.map((_, i) => {
			const a = src[(i - 1 + n) % n];
			const b = src[i];
			const c = src[(i + 1) % n];
			return {
				x: 0.25 * a.x + 0.5 * b.x + 0.25 * c.x,
				y: 0.25 * a.y + 0.5 * b.y + 0.25 * c.y
			};
		});

	const full = Math.floor(Math.max(0, config.smoothness));
	const partial = Math.max(0, config.smoothness) - full;
	for (let k = 0; k < full; k++) pts = onePass(pts);
	if (partial > 0) {
		const smoothed = onePass(pts);
		pts = pts.map((p, i) => ({
			x: p.x * (1 - partial) + smoothed[i].x * partial,
			y: p.y * (1 - partial) + smoothed[i].y * partial
		}));
	}
	return pts;
}

/** Closed cubic B-spline through the control points, and its derivative. */
function bspline(pts, t, derivative = false) {
	const n = pts.length;
	const i = ((Math.floor(t) % n) + n) % n;
	const f = t - Math.floor(t);
	const p0 = pts[(i - 1 + n) % n];
	const p1 = pts[i];
	const p2 = pts[(i + 1) % n];
	const p3 = pts[(i + 2) % n];
	const t2 = f * f;
	const t3 = t2 * f;
	const omt = 1 - f;

	const [b0, b1, b2, b3] = derivative
		? [-(omt * omt) / 2, (3 * t2 - 4 * f) / 2, (-3 * t2 + 2 * f + 1) / 2, t2 / 2]
		: [
				(omt * omt * omt) / 6,
				(3 * t3 - 6 * t2 + 4) / 6,
				(-3 * t3 + 3 * t2 + 3 * f + 1) / 6,
				t3 / 6
			];

	return {
		x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
		y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y
	};
}

/** Length and bounding box of the closed curve, sampled. */
function curveMetrics(pts, tube, samples = 240) {
	const tMax = pts.length;
	let length = 0;
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	let prev = bspline(pts, 0);

	for (let i = 0; i <= samples; i++) {
		const p = bspline(pts, (i / samples) * tMax);
		if (i > 0) length += Math.hypot(p.x - prev.x, p.y - prev.y);
		prev = p;
		if (p.x < minX) minX = p.x;
		if (p.x > maxX) maxX = p.x;
		if (p.y < minY) minY = p.y;
		if (p.y > maxY) maxY = p.y;
	}

	// The dots sit up to `tube` off the curve on every side.
	return {
		length,
		extent: Math.max(maxX - minX, maxY - minY) + 2 * tube,
		cx: (minX + maxX) / 2,
		cy: (minY + maxY) / 2
	};
}

/**
 * Backing-store size for a halo drawn at `cssPixels`. Drawing several times
 * larger and letting the browser downscale averages the dots into the mist the
 * artwork actually is.
 */
export function backingSize(cssPixels, dpr = 1, factor = 8, max = 1024) {
	return Math.max(1, Math.round(Math.min(max, Math.max(cssPixels * dpr, cssPixels * factor))));
}

/** GLSL fract(sin(x) * 43758.5453123) — the shader's per-particle random. */
function hashRand(i) {
	const s = Math.sin(i * 127.1) * 43758.5453123;
	return s - Math.floor(s);
}

/** The resting halo: no deformation at all. */
export const NO_MODULATION = { squeeze: 0, scatter: 0, swell: 0 };

/**
 * Project one dot into canvas pixels, applying `mod`.
 *
 * `tubeScatter` from the static generator turned inside out: the same
 * Frenet-ish frame, twist and perspective, evaluated for a single dot on
 * demand. With `NO_MODULATION` it reproduces the static halo exactly.
 */
export function projectDot(geo, p, mod, out) {
	const c = bspline(geo.controlPoints, p.t);
	const d = bspline(geo.controlPoints, p.t, true);

	// Frenet-ish frame. The curve is planar (z = 0), so the tangent lies in the
	// xy-plane and the normal/binormal reduce to the terms below.
	const dl = 1e-6 + Math.hypot(d.x, d.y);
	const tx = d.x / dl;
	const ty = d.y / dl;

	const dotUT = ty;
	let nx = -dotUT * tx;
	let ny = 1 - dotUT * ty;
	const nl = 1e-6 + Math.hypot(nx, ny, 0);
	nx /= nl;
	ny /= nl;

	// b = t × n, with t.z = n.z = 0.
	const bz = tx * ny - ty * nx;

	const ang = geo.twist * p.t;
	const ct = Math.cos(ang);
	const st = Math.sin(ang);

	const rx = nx * ct;
	const ry = ny * ct;
	const rz = -bz * st;
	const sx = nx * st;
	const sy = ny * st;
	const sz = bz * ct;

	// The resting offset off the curve, and where it lands across the tube.
	const ex = Math.cos(p.angle) * geo.tube;
	const ey = Math.sin(p.angle) * geo.tube;
	const restX = rx * ex + sx * ey;
	const restY = ry * ex + sy * ey;

	const rl = Math.max(Math.hypot(c.x, c.y), 1e-4);
	const rdx = c.x / rl;
	const rdy = c.y / rl;
	out.radial01 = ((rdx * restX + rdy * restY) / Math.max(geo.tube, 1e-4)) * 0.5 + 0.5;

	// The pulse squeezes every dot toward the tube's core, then flings them
	// apart — each by its own distance, so the release looks organic.
	const disperse = 1 - mod.squeeze * 0.45 + mod.scatter * (0.35 + p.rand * p.rand * 0.8);
	// The burst also throws dots away from the ring's centre.
	const push = geo.tube * mod.scatter * (0.4 * p.rand);

	const swell = 1 + mod.swell;
	const x = (c.x + restX * disperse + rdx * push) * swell;
	const y = (c.y + restY * disperse + rdy * push) * swell;
	const z = (rz * ex + sz * ey) * disperse * swell;

	// project3DWithAngles with yaw = pitch = 0.
	const perspective = FOCAL / (FOCAL + z);
	out.x = (x * perspective - geo.cx) * geo.scale + geo.pixels / 2;
	out.y = (y * perspective - geo.cy) * geo.scale + geo.pixels / 2;
	out.z = z;
	out.r = geo.dotRadius * geo.scale;
	return out;
}

/** The palette entries pre-parsed to 0..255 channels. */
function parseRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The colours a halo will be drawn in, without building one. */
export function haloPalette(seed, overrides = {}) {
	const config = { ...DEFAULT_HALO_CONFIG, ...overrides };
	// Its own stream, so colour and shape stay independent.
	const rand = rng(config.paletteSeed ?? seed);
	const slots = Math.max(1, Math.min(MAX_HALO_COLORS, config.colorCount));

	// A supplied palette is not a voice's identity — shuffled and sliced as
	// given; the brand's colour families mean nothing here.
	if (config.palette && config.palette.length) {
		const given = [...config.palette];
		for (let i = given.length - 1; i > 0; i--) {
			const j = Math.floor(rand.next() * (i + 1));
			[given[i], given[j]] = [given[j], given[i]];
		}
		return given.slice(0, slots);
	}

	// Fisher-Yates, not `sort(() => rand.next() - 0.5)`: a comparator that
	// ignores its arguments is not a shuffle.
	const families = HALO_PAIRS.map((pair) => pair);
	for (let i = families.length - 1; i > 0; i--) {
		const j = Math.floor(rand.next() * (i + 1));
		[families[i], families[j]] = [families[j], families[i]];
	}

	// The offset picks a family rather than a starting colour, so two halos with
	// different offsets share nothing at all.
	const offset =
		((Math.round(config.paletteOffset) % families.length) + families.length) % families.length;
	return [...families[offset]].slice(0, slots);
}

/**
 * Generate a halo fitted to a canvas `pixels` wide.
 *
 * The dot radius has a floor and the count is derived from the area of the band
 * the dots scatter through — hold the coverage, let the count follow.
 */
export function buildHalo(seed, pixels, overrides = {}, options = {}) {
	const config = { ...DEFAULT_HALO_CONFIG, ...overrides };
	const { minDotPx = 0.7, coverage = 0.9 } = options;

	const rand = rng(seed);
	// Drawn from its own stream, so the geometry below is unaffected by it.
	const palette = haloPalette(seed, config);

	const controlPoints = controlPointsFor(rand, config);
	const tube = lerp(6, 36, config.tubeThickness);
	const { length, extent, cx, cy } = curveMetrics(controlPoints, tube);

	// Fit the artwork to the box, as the cropped exports do.
	const scale = pixels / extent;
	const bandArea = length * 2 * tube * scale * scale;
	const dotPx = Math.max(config.dotSize * scale, minDotPx);
	const count = Math.max(
		1,
		Math.min(
			Math.round(config.dotCount),
			Math.round((coverage * bandArea) / (Math.PI * dotPx * dotPx))
		)
	);

	// The draw order off the seeded stream is load-bearing: it is what makes a
	// seed name one specific halo. Keep it — the gaussian included, which the
	// generator's own defaults multiply out but still consume.
	const tMax = controlPoints.length;
	const particles = [];
	for (let i = 0; i < count; i++) {
		const t = rand.next() * tMax;
		const angle = rand.next() * Math.PI * 2;
		rand.gaussian();
		particles.push({
			t,
			angle,
			rand: hashRand(i),
			color: Math.floor(rand.next() * palette.length)
		});
	}

	return {
		particles,
		controlPoints,
		tMax,
		tube,
		twist: config.twist,
		dotRadius: dotPx / scale,
		scale,
		cx,
		cy,
		pixels,
		palette,
		rgb: palette.map(parseRgb),
		compositeOperation: config.compositeOperation,
		glowCap: config.glowCap
	};
}

/** The resting halo, as flat dots ready to paint — the static path. */
export function dotsForCanvas(seed, pixels, overrides = {}, options = {}) {
	const geo = buildHalo(seed, pixels, overrides, options);
	const out = { x: 0, y: 0, z: 0, r: 0, radial01: 0 };
	return geo.particles
		.map((p) => {
			projectDot(geo, p, NO_MODULATION, out);
			return { x: out.x, y: out.y, r: out.r, z: out.z, c: geo.palette[p.color] };
		})
		.sort((a, b) => a.z - b.z);
}

/** A stable seed for any id, so a voice keeps its halo without storing one. */
export function seedForId(id) {
	let hash = 2166136261;
	for (let i = 0; i < id.length; i++) {
		hash ^= id.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

// ===========================================================================
// Motion (from voiceHaloMotion.ts)
// ===========================================================================

/** Under-damped spring following the voice loudness: the slight overshoot on
 *  every syllable is what makes the halo bounce organically. */
const AUDIO_SPRING_STIFFNESS = 90;
const AUDIO_SPRING_DAMPING = 9;
const AUDIO_GAIN = 2.2;

/** Syllable onsets (detected from the spring's velocity) throw brief scatters. */
const VOICE_SCATTER_GAIN = 0.12;
const VOICE_SCATTER_MAX = 0.35;
const VOICE_SCATTER_DECAY = 6;

/** The arrival pulse, one beat: contract, then release. */
const PULSE_SQUEEZE = 0.28; // seconds of accelerating contraction
const PULSE_ATTACK = 0.07; // seconds for the release to reach full energy
const PULSE_DECAY = 2.0; // per-second exponential falloff of the release
const PULSE_DURATION = 2.6; // total lifetime
const PULSE_CROSS = 0.45; // seconds for the light bloom to cross the tube

/** Dots drift this far along the curve per second at rest, as a fraction of a
 *  full lap. A lap takes about 36s. */
const FLOW_REST = 0.028;
const FLOW_PER_VOICE = 0.012; // the voice quickens it
const FLOW_PER_RELEASE = 0.08; // so does the pulse's release

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * -1..1: negative through the contraction (accelerating inward), positive
 * through the release (fast attack, slow organic decay).
 */
export function pulseEnergy(age) {
	if (age >= PULSE_DURATION) return 0;
	if (age < PULSE_SQUEEZE) {
		const p = age / PULSE_SQUEEZE;
		return -(p * p);
	}
	const t = age - PULSE_SQUEEZE;
	return Math.min(1, t / PULSE_ATTACK) * Math.exp(-t * PULSE_DECAY);
}

/** 0..1 presence: rises through the contraction, full at the release. */
export function pulseRise(age) {
	if (age >= PULSE_SQUEEZE) return 1;
	const p = age / PULSE_SQUEEZE;
	return p * p;
}

/**
 * Whole-halo scale through the pulse: a clean bounce, deliberately distinct
 * from the wavy voice deformation. (The website drives this with a GSAP
 * timeline; the three tweens and their eases are written out here.)
 */
export function punchScale(age) {
	if (age < 0) return 1;
	if (age < 0.28) {
		// power2.in
		const p = age / 0.28;
		return 1 + (0.94 - 1) * (p * p);
	}
	if (age < 0.38) {
		// power3.out
		const p = (age - 0.28) / 0.1;
		const e = 1 - (1 - p) * (1 - p) * (1 - p);
		return 0.94 + (1.02 - 0.94) * e;
	}
	if (age < 1.18) {
		// elastic.out(1, 0.65)
		return 1.02 + (1 - 1.02) * elasticOut((age - 0.38) / 0.8);
	}
	return 1;
}

function elasticOut(t, amplitude = 1, period = 0.65) {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	const s = (period / TAU) * Math.asin(1 / amplitude);
	return amplitude * Math.pow(2, -10 * t) * Math.sin(((t - s) * TAU) / period) + 1;
}

/** GLSL smoothstep, which unlike the maths one accepts reversed edges. */
function smoothstep(edge0, edge1, x) {
	const t = clamp01((x - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

/** 0..1 loudness from a Web Audio analyser — the mean of the voice band. */
export function levelFromAnalyser(node) {
	let data = new Uint8Array(new ArrayBuffer(node.frequencyBinCount));
	return () => {
		if (data.length !== node.frequencyBinCount) {
			data = new Uint8Array(new ArrayBuffer(node.frequencyBinCount));
		}
		node.getByteFrequencyData(data);
		const bins = Math.min(512, data.length);
		let sum = 0;
		for (let i = 0; i < bins; i++) sum += data[i];
		return sum / bins / 255;
	};
}

/**
 * 0..1 loudness read straight off decoded audio at the playhead — for players
 * that own their own media element, where an analyser is not an option.
 */
export function levelFromAudioBuffer(buffer, currentTime, { window = 0.05, gain = 3 } = {}) {
	const samples = buffer.getChannelData(0);
	const span = Math.max(1, Math.round(window * buffer.sampleRate));
	return () => {
		const start = Math.round(currentTime() * buffer.sampleRate);
		if (start < 0 || start >= samples.length) return 0;
		const end = Math.min(samples.length, start + span);
		let sum = 0;
		for (let i = start; i < end; i++) sum += samples[i] * samples[i];
		return Math.min(1, Math.sqrt(sum / (end - start)) * gain);
	};
}

export const RESTING_FRAME = {
	time: 0,
	explosion: 0,
	energy: 0,
	wake: -1,
	opacity: 1,
	punch: 1
};

/** Quantized glow levels, so a frame reuses colour strings. */
const GLOW_STEPS = 24;

/**
 * How far a fully glowing dot travels toward the glow target. On black the
 * target is white and the cap is the shader's own 0.85; on paper the same cap
 * turns the light front into a soot-coloured wave, so it is held at zero.
 */
const GLOW_CAP = { dark: 0.85, light: 0 };

/** How opaque each dot is on a light ground. */
const LIGHT_INK_ALPHA = 1;

/**
 * Dots drawn larger on paper. On black, `lighter` blooms overlapping dots and
 * optically fills the gaps; painting normally has no such help.
 */
const LIGHT_DOT_SCALE = 1.45;

const tints = new WeakMap();

function tintsFor(geo, surface) {
	const perSurface = tints.get(geo) ?? {};
	const cached = perSurface[surface];
	if (cached) return cached;

	const source = geo.rgb;
	const target = 255;
	const built = source.map(([r, g, b]) =>
		Array.from({ length: GLOW_STEPS + 1 }, (_, i) => {
			const m = (i / GLOW_STEPS) * (geo.glowCap ?? GLOW_CAP[surface]);
			const mix = (c) => Math.round(c + (target - c) * m);
			return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
		})
	);

	perSurface[surface] = built;
	tints.set(geo, perSurface);
	return built;
}

const scratch = { x: 0, y: 0, z: 0, r: 0, radial01: 0 };
const mod = { squeeze: 0, scatter: 0, swell: 0 };

/**
 * Paint one frame of a halo, filling the canvas the geometry was fitted to.
 *
 * On a dark ground: additive, so overlapping dots brighten rather than
 * overwrite. On a light ground: plain `source-over`, so every dot keeps its own
 * colour, with presence coming from coverage instead.
 */
export function paintHalo(ctx, geo, frame = RESTING_FRAME, surface = 'dark', filter = null) {
	const canvas = ctx.canvas;
	const size = canvas.width;

	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, size, canvas.height);

	// The halo occupies `geo.pixels` of the canvas, centred; the margin is part
	// of the design (the disc's ring of clear space).
	const offset = (size - geo.pixels) / 2;
	ctx.translate(size / 2, size / 2);
	ctx.scale(frame.punch, frame.punch);
	ctx.translate(offset - size / 2, offset - size / 2);

	ctx.globalCompositeOperation = geo.compositeOperation ?? (surface === 'dark' ? 'lighter' : 'source-over');
	ctx.globalAlpha = clamp01(frame.opacity) * (surface === 'dark' ? 1 : LIGHT_INK_ALPHA);
	const dotScale = surface === 'dark' ? 1 : LIGHT_DOT_SCALE;

	const squeeze = Math.max(-frame.energy, 0);
	const scatter = Math.max(frame.energy, 0);
	mod.squeeze = squeeze;
	mod.scatter = scatter;

	const { time, explosion, wake } = frame;
	// The wave's temporal envelopes are the same for every dot — only its
	// spatial terms vary, so hoist these three out of the loop.
	const env1 = Math.sin(time * 4.3);
	const env2 = Math.sin(time * 6.9 + 0.8);
	const env3 = Math.sin(time * 10.7 + 2.4);
	const charged = squeeze > 0;
	const lit = wake >= -0.9;
	const palette = tintsFor(geo, surface);
	const still = explosion === 0 && squeeze === 0 && scatter === 0;

	for (const p of geo.particles) {
		if (still) {
			// The resting halo: no deformation, no glow. Worth the branch — this is
			// the common frame for a `waiting` halo, where only the flow moves.
			projectDot(geo, p, NO_MODULATION, scratch);
			// Filtered after projection, not before: a depth split needs the z
			// this frame actually produced.
			if (filter && !filter(p, scratch, geo)) continue;
			ctx.fillStyle = palette[p.color][0];
			ctx.beginPath();
			ctx.arc(scratch.x, scratch.y, scratch.r * dotScale, 0, TAU);
			ctx.fill();
			continue;
		}

		// Whole-halo voice deformation: standing waves, not travelling ones — the
		// entire halo moves at once with the voice, while each zone keeps its own
		// local intensity and phase.
		const ringAngle = ((p.t % geo.tMax) / geo.tMax) * TAU;
		const wave =
			Math.sin(ringAngle * 2 + time * 0.5) * env1 +
			0.8 * Math.sin(ringAngle * 3 - time * 0.7 + 1.7) * env2 +
			0.6 * Math.sin(ringAngle * 5 + time * 0.3 + 4.2) * env3;
		// 0.065 is uniform breathing, 0.09 the local wave variation on top of it.
		// The caps are asymmetric: outward stays inside the disc's clear margin at
		// +0.10, while inward may carve much deeper hollows.
		const swellRaw = explosion * (0.065 + 0.09 * wave);
		mod.swell = swellRaw > 0 ? 0.1 * Math.tanh(swellRaw / 0.1) : 0.16 * Math.tanh(swellRaw / 0.16);

		projectDot(geo, p, mod, scratch);
		if (filter && !filter(p, scratch, geo)) continue;

		// While the halo squeezes, a charge glow builds on the inner edge; on
		// release a wide diffuse bloom bursts from that edge outward.
		const bloom = lit ? smoothstep(0.85, 0, Math.abs(scratch.radial01 - wake)) : 0;
		const charge = charged ? squeeze * smoothstep(0.55, 0, scratch.radial01) : 0;
		const glow = scatter * (0.4 + 0.6 * bloom) + charge * 0.5;

		const grow = 1 + mod.swell * 1.5 + glow - squeeze * 0.25;
		ctx.fillStyle = palette[p.color][Math.min(GLOW_STEPS, Math.round(glow * GLOW_STEPS))];
		ctx.beginPath();
		ctx.arc(scratch.x, scratch.y, Math.max(0.05, scratch.r * grow * dotScale), 0, TAU);
		ctx.fill();
	}
}

// ---------------------------------------------------------------------------
// The shared ticker — one requestAnimationFrame for every halo on the page.
// ---------------------------------------------------------------------------

const ticking = new Set();
let rafId = 0;
let lastNow = 0;

function loop(now) {
	// Clamped, so a background tab or a long task cannot blow the springs up.
	const dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0.016);
	lastNow = now;
	for (const tick of ticking) tick(dt);
	rafId = ticking.size > 0 ? requestAnimationFrame(loop) : 0;
}

function subscribe(tick) {
	if (ticking.has(tick)) return;
	ticking.add(tick);
	if (!rafId) {
		lastNow = 0;
		rafId = requestAnimationFrame(loop);
	}
}

function unsubscribe(tick) {
	if (!ticking.delete(tick)) return;
	if (ticking.size === 0 && rafId) {
		cancelAnimationFrame(rafId);
		rafId = 0;
	}
}

// ---------------------------------------------------------------------------
// The animator
// ---------------------------------------------------------------------------

/**
 * Animate one halo on one canvas.
 *
 * The canvas must already be sized (see `backingSize`) and the geometry built
 * for it; rebuilding either means a new animator. Returns immediately with the
 * resting halo painted.
 *
 * States: 'static' (painted once, no loop), 'waiting' (slow drift along the
 * curve), 'speaking' (driven by `level`), 'starting' (the arrival pulse).
 */
export function createHaloAnimator(options) {
	const {
		canvas,
		geometry,
		state: initialState = 'static',
		level: initialLevel = null,
		speed = 1,
		restOpacity: initialRestOpacity = 1,
		pauseOffscreen = true,
		surface: initialSurface = 'dark',
		manual = false,
		/** Paint only the dots this keeps. See `splitAtCurve` / `splitAtDepth`. */
		filter = null
	} = options;

	const reducedMotion =
		options.reducedMotion ??
		(typeof window !== 'undefined' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches);

	/**
	 * Where this animator paints. Usually one canvas; several when the ring is
	 * split into layers around a figure, in which case they share this one
	 * geometry and this one clock — which is the whole point. Two animators over
	 * two copies of the same seed would drift apart the moment one of them is
	 * paused off-screen or created a frame later.
	 */
	const targets = (options.targets ?? [{ canvas, filter }]).map((t) => ({
		ctx: t.canvas.getContext('2d'),
		filter: t.filter ?? null
	}));

	let state = initialState;
	let level = initialLevel;
	let restOpacity = initialRestOpacity;
	let surface = initialSurface;

	// A halo at rest is only dimmed while it is `static`; every other state is
	// live, and reads at full ink.
	const frame = {
		...RESTING_FRAME,
		opacity: initialState === 'static' ? restOpacity : 1
	};

	// Spring following the voice.
	let springLevel = 0;
	let springVelocity = 0;
	let voiceScatter = 0;
	// Age of the running pulse. Infinity means none — and a halo created in
	// `starting` is created mid-pulse, since entering that state *is* the pulse.
	let pulseAge = initialState === 'starting' ? 0 : Infinity;
	/** 0..1, eased: how much of the drift along the curve is applied. */
	let flow = initialState === 'static' ? 0 : 1;
	/** 0..1 ink presence, separate from `flow` so it can fall at its own pace. */
	let presence = initialState === 'static' ? 0 : 1;
	/** A halo that has just come alive holds its dots still through the
	 *  contraction — the drift is born at the pulse's release. */
	let awaitingPulse = initialState === 'starting';
	let visible = true;
	let destroyed = false;

	function paint() {
		for (const t of targets) {
			if (t.ctx) paintHalo(t.ctx, geometry, frame, surface, t.filter);
		}
	}

	/** Whether the halo still has something to animate. */
	function alive() {
		if (state !== 'static') return true;
		if (pulseAge < PULSE_DURATION) return true;
		// Coming to rest: let the drift and the ink ease down rather than cut.
		return flow > 0.001 || presence > 0.001;
	}

	function tick(dt) {
		const step = dt * speed;
		frame.time += step;

		if (pulseAge < PULSE_DURATION) pulseAge += dt;
		const energy = pulseEnergy(pulseAge);

		// Integrate the spring toward the current loudness.
		const target = state === 'speaking' && level ? clamp01(level()) : 0;
		springVelocity += (target - springLevel) * AUDIO_SPRING_STIFFNESS * dt;
		springVelocity *= Math.exp(-AUDIO_SPRING_DAMPING * dt);
		springLevel += springVelocity * dt;
		frame.explosion = Math.max(0, springLevel) * AUDIO_GAIN;

		// Rising spring velocity means a syllable attack: spike the scatter, then
		// let it fall away exponentially until the next beat.
		voiceScatter = Math.max(
			voiceScatter * Math.exp(-VOICE_SCATTER_DECAY * dt),
			Math.min(VOICE_SCATTER_MAX, Math.max(0, springVelocity) * VOICE_SCATTER_GAIN)
		);

		if (pulseAge < PULSE_DURATION) {
			// The pulse owns the scatter channel while it runs, and its light front
			// starts crossing the tube at the release.
			frame.energy = energy;
			const local = Math.max(0, pulseAge - PULSE_SQUEEZE);
			const p = Math.min(1, local / PULSE_CROSS);
			frame.wake = -0.4 + p * p * (3 - 2 * p) * 1.8;
			frame.punch = punchScale(pulseAge);
		} else {
			frame.energy = voiceScatter;
			frame.wake = -1;
			frame.punch = 1;
		}

		if (awaitingPulse && pulseAge > PULSE_SQUEEZE) awaitingPulse = false;

		// Rising follows the pulse exactly, so the surge stays crisp; falling is
		// eased, because going quiet should read as a fade rather than a cut.
		const presenceTarget =
			state === 'static' ? 0 : pulseAge < PULSE_DURATION ? pulseRise(pulseAge) : 1;
		presence =
			presenceTarget > presence
				? presenceTarget
				: presence + (presenceTarget - presence) * Math.min(1, dt * 5);
		frame.opacity = restOpacity + (1 - restOpacity) * presence;

		const flowTarget = state === 'static' || awaitingPulse ? 0 : 1;
		flow += (flowTarget - flow) * Math.min(1, dt * 3);

		// The voice quickens the drift, and so does the pulse's release.
		const advance =
			step *
			(FLOW_REST + frame.explosion * FLOW_PER_VOICE + Math.max(0, energy) * FLOW_PER_RELEASE) *
			flow *
			geometry.tMax;
		if (advance > 0) {
			for (const p of geometry.particles) p.t = (p.t + advance) % geometry.tMax;
		}

		paint();
		if (!alive()) unsubscribe(tick);
	}

	function sync() {
		// A manual animator has no loop to join or leave: `step()` is its clock.
		if (destroyed || manual) return;
		if (reducedMotion) {
			// One resting frame; the motion is what's dropped, not the look.
			frame.opacity = state === 'static' ? restOpacity : 1;
			paint();
			return;
		}
		if (visible && alive()) subscribe(tick);
		else unsubscribe(tick);
	}

	let observer = null;
	if (pauseOffscreen && !manual && !reducedMotion && typeof IntersectionObserver !== 'undefined') {
		observer = new IntersectionObserver((entries) => {
			const next = entries[entries.length - 1]?.isIntersecting ?? true;
			if (next === visible) return;
			visible = next;
			sync();
		});
		// Layers move together, so watching the first is watching all of them.
		const watched = canvas ?? options.targets?.[0]?.canvas;
		if (watched) observer.observe(watched);
	}

	paint();
	sync();

	return {
		setState(next) {
			if (next === state || destroyed) return;
			const wasStatic = state === 'static';
			state = next;
			// Leaving `static` starts the clock over: a halo that has been sitting
			// still should not jump into the middle of a wave.
			if (wasStatic) frame.time = 0;
			// Entering `starting` *is* the first-click pulse.
			if (next === 'starting') {
				pulseAge = 0;
				awaitingPulse = true;
			}
			sync();
		},
		setLevel(next) {
			level = next;
		},
		setRestOpacity(next) {
			if (destroyed || next === restOpacity) return;
			restOpacity = next;
			sync();
		},
		setSurface(next) {
			if (destroyed || next === surface) return;
			surface = next;
			// The frame on screen was painted on the old ground and nothing is
			// obliged to repaint it — a settled halo has left the loop.
			paint();
			sync();
		},
		pulse() {
			if (destroyed) return;
			pulseAge = 0;
			awaitingPulse = true;
			sync();
		},
		step(dt) {
			if (destroyed || !manual) return;
			tick(dt);
		},
		destroy() {
			destroyed = true;
			unsubscribe(tick);
			observer?.disconnect();
			observer = null;
		}
	};
}

// ===========================================================================
// The mount wrapper (from VoiceHalo.svelte)
// ===========================================================================

/**
 * The halo fills 73.333% of the disc in the design; the rest stays clear — and
 * doubles as the headroom the voice swells into.
 */
export const HALO_INSET = 0.73333;

/**
 * Mount a halo into `host`, sized, supersampled and animating.
 *
 * `host` is any element; a transparent canvas is appended and absolutely
 * positioned inside it, so give it `position: relative` — or let this set it,
 * which it does when the host is `static`. Particles only: there is no disc,
 * no orb and no background of any kind, so whatever is behind the host shows
 * through the ring.
 *
 * Options mirror VoiceHalo.svelte's props:
 *   seed        fixes the halo. Same seed, same halo.
 *   id          derives the seed from a string when no seed is given.
 *   size        rendered size in px. The voice-design hero card is 400.
 *   config      generator overrides — pass PROFILE_HALO_CONFIG for the hero look.
 *   surface     'dark' | 'light' — the ground behind the canvas, which decides
 *               how the dots are composited. Not the app theme.
 *   state       'static' | 'waiting' | 'speaking' | 'starting'.
 *   level       () => 0..1 loudness, sampled every frame while speaking.
 *   analyser    an AnalyserNode to read the level from instead.
 *   speed       multiplier on the motion's clock.
 *   restOpacity ink of a halo that is not live, 0..1.
 *   supersample how far past `size` the halo is drawn before the browser
 *               downscales. 8 for small avatars, 2 for large animated ones.
 *   filter      (particle, projected) => boolean. Paint only the dots it keeps.
 *               This is how the ring is interleaved with a figure: mount it
 *               twice over the same seed, one layer behind the figure and one
 *               in front, with complementary filters. See `splitAtCurve`.
 *   round       clip the host to a circle. Off by default — a ring woven
 *               through a figure must not be clipped to its own box.
 *
 * Returns { canvas, geometry, animator, setState, setLevel, setSurface,
 *           setRestOpacity, pulse, destroy }.
 */
export function mountVoiceHalo(host, options = {}) {
	const {
		seed,
		id,
		size = 15,
		config,
		surface = 'dark',
		state = 'static',
		level = null,
		analyser = null,
		speed = 1,
		restOpacity = 1,
		supersample = 8,
		reducedMotion,
		pauseOffscreen = true,
		filter = null,
		round = false
	} = options;

	const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
	const pixels = backingSize(size, dpr, supersample);
	const resolvedSeed = seed ?? (id ? seedForId(id) : 0);

	if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
	if (round) {
		host.style.overflow = host.style.overflow || 'hidden';
		host.style.borderRadius = host.style.borderRadius || '9999px';
	}
	if (!host.style.width) host.style.width = `${size}px`;
	if (!host.style.height) host.style.height = `${size}px`;

	const canvas = document.createElement('canvas');
	// Assigning either dimension resets the context, transform included.
	canvas.width = pixels;
	canvas.height = pixels;
	canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
	host.appendChild(canvas);

	const geometry = buildHalo(resolvedSeed, pixels * HALO_INSET, config);

	const animator = createHaloAnimator({
		canvas,
		geometry,
		state,
		level: level ?? (analyser ? levelFromAnalyser(analyser) : null),
		speed,
		restOpacity,
		surface,
		reducedMotion,
		pauseOffscreen,
		filter
	});

	return {
		canvas,
		geometry,
		animator,
		seed: resolvedSeed,
		setState: (next) => animator.setState(next),
		setLevel: (next) => animator.setLevel(next),
		setRestOpacity: (next) => animator.setRestOpacity(next),
		setSurface: (next) => animator.setSurface(next),
		pulse: () => animator.pulse(),
		destroy() {
			animator.destroy();
			canvas.remove();
		}
	};
}

/**
 * Mount one halo across several stacked hosts — the way to weave the ring
 * through a figure.
 *
 * The particles are NOT a flat layer over or under the character: the ring has
 * to pass behind it on one side and in front of it on the other, the way it
 * does in the hero. That means two canvases with the character sandwiched
 * between them in z-order, both painting complementary halves of the *same*
 * ring.
 *
 * One geometry and one animator drive every layer here, so the halves can
 * never drift apart. Mounting two separate halos over the same seed looks
 * equivalent and is not: they desync the moment one is paused off-screen, and
 * you get two rings sliding past each other.
 *
 *   <div class="stack">
 *     <div id="halo-back"></div>     <!-- z-index: 0 -->
 *     <img id="figure" src="...">    <!-- z-index: 1 -->
 *     <div id="halo-front"></div>    <!-- z-index: 2 -->
 *   </div>
 *
 *   const [back, front] = splitAtCurve(0.15, 0.62);
 *   const halo = mountVoiceHaloLayers(
 *     [
 *       { host: document.getElementById('halo-back'), filter: back },
 *       { host: document.getElementById('halo-front'), filter: front }
 *     ],
 *     { seed: 1337, size: 520, config: PROFILE_HALO_CONFIG, supersample: 2,
 *       state: 'waiting', pauseOffscreen: false, reducedMotion: false }
 *   );
 *
 * Every layer must be the same `size` and sit at the same place in the stack,
 * or the two halves will not line up. Returns the same handle as
 * `mountVoiceHalo`, plus `canvases`.
 */
export function mountVoiceHaloLayers(layers, options = {}) {
	const {
		seed,
		id,
		size = 15,
		config,
		surface = 'dark',
		state = 'static',
		level = null,
		analyser = null,
		speed = 1,
		restOpacity = 1,
		supersample = 8,
		reducedMotion,
		pauseOffscreen = true
	} = options;

	const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
	const pixels = backingSize(size, dpr, supersample);
	const resolvedSeed = seed ?? (id ? seedForId(id) : 0);

	const targets = layers.map(({ host, filter = null }) => {
		if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
		if (!host.style.width) host.style.width = `${size}px`;
		if (!host.style.height) host.style.height = `${size}px`;
		const canvas = document.createElement('canvas');
		canvas.width = pixels;
		canvas.height = pixels;
		canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
		host.appendChild(canvas);
		return { canvas, filter };
	});

	const geometry = buildHalo(resolvedSeed, pixels * HALO_INSET, config);

	const animator = createHaloAnimator({
		targets,
		geometry,
		state,
		level: level ?? (analyser ? levelFromAnalyser(analyser) : null),
		speed,
		restOpacity,
		surface,
		reducedMotion,
		pauseOffscreen
	});

	return {
		canvases: targets.map((t) => t.canvas),
		geometry,
		animator,
		seed: resolvedSeed,
		setState: (next) => animator.setState(next),
		setLevel: (next) => animator.setLevel(next),
		setRestOpacity: (next) => animator.setRestOpacity(next),
		setSurface: (next) => animator.setSurface(next),
		pulse: () => animator.pulse(),
		destroy() {
			animator.destroy();
			for (const t of targets) t.canvas.remove();
		}
	};
}

/**
 * A complementary pair of filters that cut the ring at two points on its curve.
 *
 * The arc between `from` and `to` (both 0..1 around the loop) is the "back"
 * half — the stretch that should pass *behind* the figure — and everything else
 * is the "front" half. Mount the same seed twice with these, stack the figure
 * between the two canvases, and the ring is woven through it rather than
 * floating over or under it as a flat layer.
 *
 *   const [back, front] = splitAtCurve(0.15, 0.62);
 *   mountVoiceHalo(behindEl, { seed, filter: back,  ...opts });  // z-index 0
 *   //  <img class="figure">                                         z-index 1
 *   mountVoiceHalo(frontEl,  { seed, filter: front, ...opts });  // z-index 2
 *
 * Where to cut is a judgement about the artwork, not something this can infer:
 * pick the two points where the ring crosses the figure's silhouette.
 */
export function splitAtCurve(from, to) {
	const within = (p, geo) => {
		const u = ((p.t % geo.tMax) / geo.tMax + 1) % 1;
		return from <= to ? u >= from && u < to : u >= from || u < to;
	};
	return [
		(p, _projected, geo) => within(p, geo),
		(p, _projected, geo) => !within(p, geo)
	];
}

/**
 * A complementary pair of filters that split the ring by its own depth.
 *
 * The tube has real thickness in z, so half its dots sit nearer the viewer than
 * the curve and half sit further. Splitting there and sandwiching a figure
 * between the halves reads as the figure sitting *inside* the band. Subtler
 * than `splitAtCurve` and it needs no knowledge of the artwork, but it only
 * works when the figure is small enough to live within the tube.
 */
export function splitAtDepth() {
	return [
		(_p, projected) => projected.z >= 0,
		(_p, projected) => projected.z < 0
	];
}
