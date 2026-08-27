/**
 * Motion-design intelligence injected into every HyperFrames authoring prompt.
 *
 * Distilled from two design-skill sources:
 * - "UI UX Pro Max" design-system reasoning: style direction, palette
 *   discipline, typography pairing, anti-patterns, pre-delivery checklist.
 * - "60fps animation" performance skill: compositor-only properties,
 *   easing vocabulary, staggered choreography, layout-thrash avoidance.
 */

export interface StyleDirection {
	name: string;
	mood: string;
	palette: string;
	typography: string;
	motion: string;
}

const STYLE_DIRECTIONS: Array<StyleDirection & { keywords: string[] }> = [
	{
		keywords: [
			"ai",
			"tech",
			"data",
			"saaS",
			"software",
			"code",
			"fintech",
			"crypto",
			"startup",
			"developer",
			"dashboard",
			"analytics",
			"cyber",
		],
		name: "Dark tech / AI-native",
		mood: "precise, futuristic, high-signal",
		palette:
			"near-black or deep navy ground, one electric accent (cyan, lime, or violet), white text; glow used sparingly for emphasis only",
		typography:
			"geometric/technical sans (Inter, Space Grotesk, IBM Plex) with tabular numerals for stats; monospace accents for labels",
		motion: "sharp masked reveals, counters ticking up, thin scan/grid lines drawing in, expo-out easing",
	},
	{
		keywords: [
			"hype",
			"energy",
			"gaming",
			"sport",
			"music",
			"party",
			"sale",
			"launch",
			"bold",
			"viral",
			"tiktok",
			"shorts",
			"reels",
		],
		name: "Bold kinetic / hype edit",
		mood: "loud, punchy, rhythmic",
		palette:
			"high-contrast duotone (e.g. black + acid yellow/red/blue), oversized type as the hero element, hard edges",
		typography:
			"heavy condensed display faces (Anton, Archivo Black, Bebas); huge scale jumps between hierarchy levels",
		motion: "fast whip cuts between states, scale punches, rotation snaps, beat-synced pops, back.out easing",
	},
	{
		keywords: [
			"calm",
			"wellness",
			"spa",
			"meditation",
			"nature",
			"health",
			"mindful",
			"yoga",
			"sleep",
			"soft",
			"gentle",
		],
		name: "Soft minimal / wellness",
		mood: "serene, warm, breathing room everywhere",
		palette:
			"warm off-white or pale sage ground, muted pastel accent, charcoal text; soft shadows for gentle depth",
		typography:
			"humanist sans (Montserrat, Nunito Sans) or elegant serif display (Cormorant Garamond) paired with clean sans body",
		motion: "slow long eases (1s+), soft fades with slight drift, organic shapes morphing gently, generous holds",
	},
	{
		keywords: [
			"luxury",
			"premium",
			"elegance",
			"fashion",
			"jewelry",
			"hotel",
			"fine",
			"wedding",
			"editorial",
			"magazine",
		],
		name: "Elegant editorial / luxury",
		mood: "refined, confident, cinematic pacing",
		palette:
			"ivory/deep-charcoal ground, gold or champagne accent, restrained monochrome imagery feel",
		typography:
			"classy serif display (Playfair Display, Cormorant) + light-tracked sans support; wide letter-spacing on labels",
		motion: "slow curtain/mask reveals, letters tracking in one by one, silky power2.inOut cross-fades, nothing bounces",
	},
	{
		keywords: [
			"fun",
			"playful",
			"kids",
			"cartoon",
			"candy",
			"game",
			"casual",
			"friendly",
			"bubbly",
		],
		name: "Playful claymorphism",
		mood: "cheerful, rounded, bouncy",
		palette:
			"vivid candy palette on light ground (3 hues max), soft puffy shapes, chunky rounded corners",
		typography:
			"rounded friendly faces (Baloo 2, Fredoka, Quicksand); thick weights, generous size contrast",
		motion: "squash-and-stretch scale pops, elastic.out overshoot, wobble loops, elements hopping in sequence",
	},
	{
		keywords: [
			"business",
			"finance",
			"banking",
			"corporate",
			"insurance",
			"legal",
			"consulting",
			"report",
			"quarterly",
			"invoice",
		],
		name: "Trustworthy structured / fintech",
		mood: "credible, organized, data-forward",
		palette:
			"deep navy/slate ground or white ground, trustworthy blue + one warm CTA accent, never neon",
		typography:
			"neutral grotesque (Inter, Public Sans); strict hierarchy scale, tabular numbers, small-caps section labels",
		motion: "grid-aligned slide-ins, bar/count-up charts, precise stagger of list rows, no playful overshoot",
	},
];

const FALLBACK_DIRECTION: StyleDirection = {
	name: "Clean modern minimal",
	mood: "confident, uncluttered, message-first",
	palette:
		"near-black ground or white ground, single vivid accent, 60-30-10 distribution (ground/type/accent)",
	typography:
		"one strong sans family (Inter, Space Grotesk) with a bold display weight for headlines and regular for support",
	motion: "staggered masked reveals, smooth expo-out entrances, subtle parallax depth between layers",
};

/** Picks an art direction from free text (scene intent, keywords, transcript). */
export function deriveStyleDirection(text: string): StyleDirection {
	const haystack = (text || "").toLowerCase();
	let best: { score: number; direction: StyleDirection } | null = null;
	for (const entry of STYLE_DIRECTIONS) {
		let score = 0;
		for (const keyword of entry.keywords) {
			if (haystack.includes(keyword.toLowerCase())) score += 1;
		}
		if (score > 0 && (!best || score > best.score)) {
			best = { score, direction: entry };
		}
	}
	return best?.direction ?? FALLBACK_DIRECTION;
}

/**
 * Builds the motion-craft guidance block embedded into authoring prompts.
 * Flow/beats advice is scaled to the composition duration.
 */
export function buildMotionDesignSkills(durationSecs: number): string {
	const beats = flowBeats(durationSecs);
	return `MOTION DESIGN CRAFT — the scene must look art-directed and feel alive, not merely functional.

ART DIRECTION
- Commit to ONE coherent visual system across every element in the scene (background, cards, type, shapes all share the same language).
- Color discipline: one dominant ground color, one accent reserved for emphasis and key data, neutrals for everything else. Max 5 colors total. Follow 60-30-10 distribution. Never use the tired "AI purple-pink gradient" cliché unless explicitly asked.
- Typography discipline: max 2 font families. Build real hierarchy — display headline, supporting line, caption/label — with clear size jumps (at least 2x between levels). Track out uppercase labels. Never let text sit as an afterthought; type IS the visual.
- Composition: respect safe margins (~8% padding). One hero element per moment — everything else supports it. Use rule-of-thirds placement and asymmetric balance instead of centering everything. Give elements breathing room; density kills polish.
- Background treatment: never leave a flat empty void — add a subtle layered gradient, faint grid/dots, soft vignette, or drifting ambient shape so the frame has depth at every moment.
- Icons/shapes: inline SVG geometric shapes and unicode symbols are fine; never emoji as icons; keep stroke weights consistent.

FLOW & CHOREOGRAPHY (${beats})
- The scene has rhythm, not simultaneous appearance. Sequence elements into ${beats} distinct beats so each idea lands before the next arrives.
- Start every element hidden (opacity 0 or clipped) and reveal it with a timeline tween at its beat — motion must be visible during playback; a frame that is already complete before anything moves reads as broken.
- Stagger related items (list rows, words, cards) by 0.08-0.15s each — cascading entrances read as premium.
- Overlap consecutive animations by ~15% (start the next element before the previous fully settles) so energy flows continuously. Avoid dead air longer than 0.4s anywhere mid-scene; fill holds with ambient background motion.
- Entrances should imply exits: if an element leaves, animate it out purposefully (mask wipe, drift with fade, scale down) rather than vanishing.
- Kinetic typography: reveal words or lines with clipped mask wipes or per-word staggers; let numbers count up to their value; emphasize keywords in the accent color exactly when they matter.

EASING & TIMING VOCABULARY
- Entrances: expo.out or power4.out (fast start, soft landing). Playful scenes may use back.out(1.4). Exits: power2.in. Loops/pulses: sine.inOut. Never linear except for continuous ambient drift.
- Micro-animations 0.25-0.5s, standard moves 0.6-0.9s, cinematic reveals up to 1.4s. Overshoot sparingly — one expressive move per beat, not every element bouncing.

PERFORMANCE (compositor-only motion)
- Animate ONLY transform and opacity via GSAP/CSS transforms. Never tween width, height, top, left, margin, box-shadow, filter blur, or background-position — these force layout/paint every frame and stutter at render time.
- Need a resize? Use scaleX/scaleY on a container (keep text crisp by scaling the wrapper, not glyphs). Need a shadow transition? Paint it once and tween opacity of that layer. Need blur? Cross-fade two layers instead of animating blur radius.
- Prefer transform-origin-aware moves (translate/scale/rotate) and opacity cross-fades for ALL transitions including hover-like pulses and looping ambience.

PRE-DELIVERY CHECKLIST (verify before returning)
- Playing the timeline from 0 shows continuous motion — every element enters, transforms or exits via tweens; nothing is ever a frozen frame.
- At any paused timestamp the layout looks finished and art-directed; the final state is stable and intentional (end on the payoff, not mid-motion).
- All text fully readable against its background (contrast >= 4.5:1), nothing clipped at edges or overlapping other elements.
- Every clip has an entrance; nothing pops in with zero animation; nothing lingers frozen mid-scene without ambient life.
- One visual system throughout: same corner radii, same stroke widths, same spacing logic, same palette everywhere.`;
}

function flowBeats(durationSecs: number): string {
	const count = Math.max(2, Math.min(7, Math.round(durationSecs / 1.5)));
	return `a ${durationSecs}s scene = about ${count} beats`;
}
