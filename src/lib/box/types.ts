// Data model for the box builder. A BoxConfig is persisted (keyed by the dice
// set it belongs to) and fully describes a printable carry box: the parametric
// shell dimensions, how each die is placed/oriented, and the optional magnet /
// hinge hardware. Geometry is produced from this by box_builder.ts.
//
// The box is an EDDC-style clamshell: a base and a lid of *equal height*, each a
// solid octagonal slab (the rectangular footprint has its four corners truncated
// so it reads as an 8-sided shape from above). Every die straddles the seam
// where the two halves meet - its mid-point sits on the seam, so the base holds
// the lower half of each die and the lid the (mirrored) upper half. Magnets in
// the truncated corners hold the two halves shut.

// Which half of the box a die's preview geometry belongs to. Every die straddles
// the seam, so this is only a render-routing tag, not a placement choice.
export type BoxHalf = 'base' | 'lid';

// Placement of a single die within the box.
export type BoxDiePlacement = {
	// references Dice.id within the set.
	dieId: string;
	// position within the layout (lower = earlier). The layout engine sorts by
	// this, so reordering is just renumbering.
	order: number;
	// extra in-plane (about the vertical axis) rotation in radians, applied on
	// top of the auto-chosen resting orientation.
	rotation: number;
	// manual centre position (mm) in the box frame, set by the 2D layout editor.
	// Only used when params.manual is true; the auto-layout ignores it.
	x: number;
	y: number;
	// include this die in the box at all.
	include: boolean;
};

// Optional print-in / push-in magnet hardware. The clamshell relies on magnets
// to stay shut, so they are enabled by default.
export type MagnetMode = 'printin' | 'pushin';
export type MagnetConfig = {
	enabled: boolean;
	// how many magnet bores to place (in the truncated corners, opening side
	// first). 4 = one per corner.
	count: number;
	// magnet disc dimensions (the EDDC reference uses 6mm x 3mm).
	diameter: number;
	thickness: number;
	// extra clearance added to the bore so the magnet drops in / the bridge
	// clears.
	tolerance: number;
	// push-in: an open bore from the seam. print-in: a blind pocket bridged over
	// partway so the magnet is captured mid-print.
	mode: MagnetMode;
};

// Optional print-in-place knuckle hinge between base and lid (EDDC-style). When
// on, the back edge grows interleaving knuckles around a continuous pin: the
// base carries bored barrels and the lid carries the pin + its own barrels, so
// the two halves print interlocked (open and flat) and fold shut about the seam
// plane. A hinged box only needs magnets on the opening side, so enabling it
// drops the magnet count to the opening pair.
//
// The barrel/pin/clearance/knuckle figures are scaled from the EDDC reference
// and clamped to the box's seam height; they are not surfaced in the shipped UI
// (only the `enabled` toggle is), but developer mode exposes them as live
// sliders so the hinge can be dialled in. A value of 0 means "use the default".
export type HingeConfig = {
	enabled: boolean;
	// solid pin radius (mm).
	pinRadius: number;
	// knuckle barrel outer radius (mm). The barrel's lower half is buried in the
	// back wall (the anchor); its upper half is the visible hinge bump.
	barrelRadius: number;
	// print-in-place gap, applied both radially (pin vs barrel bore) and axially
	// (between adjacent base/lid knuckles) so nothing fuses and the joint spins.
	clearance: number;
	// knuckles per hinge cluster (alternating base/lid along the edge).
	knuckles: number;
	// 45-degree clearance chamfer (mm) on each half's inner-wall/seam edge behind
	// the knuckles, so the opposing barrel can swing through and the lid opens
	// flat. 0 = off.
	indent: number;
};

// The parametric shell + cavity controls.
export type BoxParams = {
	// straight side-wall thickness (material between the dice margin and the
	// outer edge).
	wall: number;
	// solid floor/ceiling left under the deepest cavity in each half.
	floor: number;
	// how far the four outer corners are truncated (the octagon chamfer). Larger
	// values leave more room in the corners for magnets.
	chamfer: number;
	// 45-degree chamfer around the exterior (bottom) perimeter edge of each half,
	// giving the EDDC case its bevelled outer profile.
	bevel: number;
	// spacing between adjacent die cavities.
	gap: number;
	// clearance from the dice field to the inner wall, set independently for the
	// horizontal (x) and vertical (y) directions.
	marginX: number;
	marginY: number;
	// clearance added around every die to form its cavity (so the real die drops
	// in/out easily).
	cavityTolerance: number;
	// shallow recess of the interior octagon below the seam on each half, leaving
	// a flat rim around the perimeter (the corners stay solid for the magnets).
	// Kept small so the floor under the cavities stays deep.
	trayDepthBase: number;
	trayDepthLid: number;
	// how many rows the dice are split across. The dice are filled in order into
	// this many rows (larger rows first) and each row is centred relative to the
	// others, so this directly shapes the box (1 row = a long thin box). Only used
	// to seed the auto-layout (and the editor's auto-arrange).
	rows: number;
	// when true, the box uses the 2D layout editor's manual placements (each
	// placement's x/y/rotation) and the explicit box half-extents below, instead
	// of the parametric auto-layout. Set by the editor on apply.
	manual: boolean;
	// body-octagon half-extents (the seam footprint = outerHalf) chosen in the
	// editor. Only used when manual is true; {0,0} means "not set" (fall back to
	// the auto-layout sizing).
	box: { halfX: number; halfY: number };
	magnets: MagnetConfig;
	hinge: HingeConfig;
};

export type BoxConfig = {
	// the dice set this box was designed for.
	setId: string;
	updated: number;
	params: BoxParams;
	placements: Array<BoxDiePlacement>;
};

export const defaultBoxParams = (): BoxParams => ({
	wall: 2.4,
	floor: 1.6,
	chamfer: 12,
	bevel: 3,
	gap: 2,
	marginX: 3,
	marginY: 3,
	cavityTolerance: 0.4,
	trayDepthBase: 1.5,
	trayDepthLid: 1.5,
	rows: 2,
	manual: false,
	box: { halfX: 0, halfY: 0 },
	magnets: {
		enabled: true,
		count: 4,
		diameter: 6,
		thickness: 3,
		tolerance: 0.15,
		mode: 'pushin'
	},
	hinge: {
		enabled: false,
		pinRadius: 1.6,
		barrelRadius: 3.4,
		clearance: 0.35,
		knuckles: 3,
		indent: 0
	}
});
