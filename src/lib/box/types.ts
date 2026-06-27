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

// Optional living/pin hinge between base and lid. Disabled in v1; when on it
// halves the magnet count (a hinged box only needs magnets on the opening side).
export type HingeConfig = {
	enabled: boolean;
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
	// margin from the dice field to the inner wall.
	margin: number;
	// clearance added around every die to form its cavity (so the real die drops
	// in/out easily).
	cavityTolerance: number;
	// shallow recess of the interior octagon below the seam, leaving a flat rim
	// around the perimeter (the corners stay solid for the magnets). Kept small
	// so the floor under the cavities stays deep.
	trayDepth: number;
	// how many rows the dice are split across. The dice are filled in order into
	// this many rows (larger rows first) and each row is centred relative to the
	// others, so this directly shapes the box (1 row = a long thin box).
	rows: number;
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
	margin: 3,
	cavityTolerance: 0.4,
	trayDepth: 1.5,
	rows: 2,
	magnets: {
		enabled: true,
		count: 4,
		diameter: 6,
		thickness: 3,
		tolerance: 0.15,
		mode: 'pushin'
	},
	hinge: {
		enabled: false
	}
});
