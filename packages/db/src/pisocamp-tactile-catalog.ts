import {
	PisoCampTactileMapSchema,
	PisoCampTiltEffectSchema,
	type PisoCampTactileMap,
	type PisoCampTiltEffect,
} from "@repo/contracts"

/**
 * CE-4 approved tactile simulation map.
 *
 * The regions are positions on the packaged **neutral, fictional** banknote
 * illustration, not on any real note. They teach what kinds of tactile feature
 * exist and roughly where a note carries them; they are not a guide to the
 * layout of a specific denomination, and the viewer says so on screen.
 *
 * Every mandatory banknote shares this map, exactly as every mandatory coin
 * shares one neutral 3D model: the illustration they are anchored to is the
 * same one. When BSP-approved, denomination-specific maps arrive they replace
 * this table and nothing else moves.
 */
const NEUTRAL_BANKNOTE_TACTILE_MAP: PisoCampTactileMap = PisoCampTactileMapSchema.parse([
	{
		id: "embossed-value",
		label: "Embossed value",
		pattern: "embossed",
		x: 60,
		y: 620,
		width: 300,
		height: 220,
	},
	{
		id: "tactile-bars",
		label: "Tactile bars",
		pattern: "bars",
		x: 780,
		y: 200,
		width: 170,
		height: 600,
	},
	{
		id: "intaglio-print",
		label: "Raised intaglio print",
		pattern: "intaglio",
		x: 330,
		y: 180,
		width: 380,
		height: 340,
	},
])

/**
 * The tactile map for a denomination, or `null` when it has none. Only
 * banknotes do: CE-4 simulates what a note feels like, and coins are the
 * 3D viewer's subject.
 */
export function tactileMapFor(mediaKind: "banknote" | "coin"): PisoCampTactileMap | null {
	return mediaKind === "banknote" ? NEUTRAL_BANKNOTE_TACTILE_MAP : null
}

/**
 * CE-5 approved dynamic-feature effect.
 *
 * Anchored to the same neutral, fictional illustration as the tactile map, and
 * shared by every mandatory banknote for the same reason. The viewer labels it
 * an educational simulation.
 */
const NEUTRAL_BANKNOTE_TILT_EFFECT: PisoCampTiltEffect = PisoCampTiltEffectSchema.parse({
	id: "dynamic-band",
	label: "Colour-shifting band",
	effect: "moving-band",
	x: 380,
	y: 560,
	width: 400,
	height: 200,
})

/** The tilt effect for a denomination, or `null` when it has none. */
export function tiltEffectFor(mediaKind: "banknote" | "coin"): PisoCampTiltEffect | null {
	return mediaKind === "banknote" ? NEUTRAL_BANKNOTE_TILT_EFFECT : null
}
