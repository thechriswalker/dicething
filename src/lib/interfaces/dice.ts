import type { Transform } from '$lib/utils/3d';
import type { Legend } from '$lib/utils/legends';
import type { BufferGeometry, Shape, Vector2 } from 'three';

export type DieTags = {
	kind: string; // broad shape family, e.g. "polyhedron", "trapezohedron"
	variant?: string; // optional sub-shape, e.g. "rhombic", "cube"
	sides: string; // "2".."20", and "00" for d%
	rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
};

export type DieModel = {
	id: string; // stable name for serialisation
	parameters: Array<DiceParameter>;
	// name of this dice type
	name: string;
	// metadata used to group/sort dice (e.g. in the "add dice" picker).
	// optional on the type, but attached + validated for every registered die
	// in src/lib/dice/index.ts (the unregistered legend pseudo-die has none).
	tags?: DieTags;
	// optional string-valued parameters (e.g. a custom SVG path). these live in a
	// separate channel from the numeric `parameters` since the rest of the system
	// is built around `Record<string, number>`. defaults to none.
	stringParameters?: Array<StringParameter>;
	// create a "blank" from the parameters. `stringParams` carries any
	// string-valued parameters declared in `stringParameters` (defaults to {}).
	build(
		params: Record<string, number>,
		stringParams?: Record<string, string>
	): {
		faces: Array<DieFaceModel>;
		faceToFaceDistance: number;

		// some dice beenfit from explicitly sizing the symbols for each face.
		// if this flag is set, the builder will size each face specifically for it's legend
		// otherwise, we'll find the biggest fit for each face, but scale all legends evenly
		sizeLegendsIndividually?: boolean;

		// how to transform the model for printing
		// the model is usually centered on the origin, so this will be a rotation
		// to move the object to the correct orientation and then a y translation to
		// raise the object so the lowest point sits PRINT_CLEARANCE_MM above the xz
		// plane. Default (when omitted): sharpest vertex pointing down (−Y), then
		// lifted — see computePointDownPrintingTransform.
		// this is the orientation we want to use to print, keeping all dice on the same level, for when / if they are grouped.
		// optional: when omitted the exporter computes a point-down default.
		printingTransform?: Transform;

		// extra rotation for the catalogue/thumbnail preview camera. the previewer
		// points straight at the highest-numbered face, which for flat-faced dice
		// (e.g. the cube d6) hides the shape behind a single face. this transform is
		// applied to the camera in the *face's* local frame (before the face
		// orientation), so a small tilt nudges the view off-axis to reveal adjacent
		// faces and read as a 3D object. omitted = look straight at the face.
		previewTransform?: Transform;
	};
	// optional override for how this die should lie in a box cavity (the box
	// builder, see $lib/box). Mirrors `printingTransform`, but for *resting* the
	// die flat rather than orienting it for printing. Only the rotation is used;
	// the box builder re-centres the die and drops it onto the cavity floor
	// itself. When omitted, the box builder auto-picks a stable flat orientation
	// from the geometry (see $lib/box/orient.ts). Set this for dice whose
	// auto-chosen lie reads wrong (e.g. a die that should rest on a specific
	// face).
	boxTransform?: Transform;
	// optional positive support geometry to prop a die that rests at a steep
	// `boxTransform` angle so it can't tip when seated (e.g. a tilted coin). It is
	// unioned into the BASE only. Returned in the die's rotation-0 laid-flat XY frame
	// (origin-centred in x/y, as the cavity is) but in GLOBAL box Z (z = 0 is the base
	// floor, z = `ctx.seam` is the parting plane). Where the support rises above the
	// seam it sits inside the lid's coin cavity; the builder grows that cavity by extra
	// tolerance (for dice that supply a support) so the fin fits without clashing.
	// `ctx.cavityTolerance` is the clearance the box grows the cavity by; matching it
	// lets the support sit flush with (and within) the cavity rather than binding it.
	boxSupport?(
		params: Record<string, number>,
		stringParams: Record<string, string>,
		ctx: { seam: number; floor: number; cavityTolerance: number }
	): BufferGeometry | undefined;
	// create parameters for building a blank using the "build" function that is
	// offset from the given parameters by `offset`.
	// note that offset could be positive or negative - as people might want "inverse"
	// blanks that are bigger than the numbered dice, or regular ones that are
	// smaller than the numbered dice (e.g. to cast/paint into an engraved master).
	// either way, the offset should be at least your engraving depth + wiggle room.
	// Resizing via these params (rather than a morphological sphere offset) keeps
	// sharp edges on both bigger and smaller blanks.
	blankParameters(params: Record<string, number>, offset: number): Record<string, number>;
	// the 2D outline (centered at the origin) to use as the base of a printing
	// "platform" for this die. when omitted, the export flow falls back to the
	// die's largest built face shape. dice that split one physical face into
	// several model faces (e.g. the caltrop d4 with 12 segment faces) MUST
	// override this to return the true outer face outline.
	platformShape?(params: Record<string, number>): Shape;
};

export type FaceParams = {
	legend?: Legend;
	scale?: number;
	offset?: Vector2;
	rotation?: number;
	extraDepth?: number;
};

export type DieFaceModel = {
	// true if this is a "number" face.
	// it could still be blank, and a non-number face can have a symbol...
	// but this informs the UI
	isNumberFace: boolean;
	// "non-face" faces: still built into the geometry and exported, but never
	// surfaced in the UI (not listed, not selectable). used for the many tiny
	// rim segments that make a coin (D2) look round without flooding the face
	// list with hundreds of un-editable "faces". always implies a non-number,
	// blank face. defaults to false/undefined.
	hidden?: boolean;
	// the outer shape for this face.
	shape: Shape;
	// whether `shape` is convex. undefined/true selects the fast convex-only
	// legend scaling/containment maths (correct for every die except a custom
	// coin outline). set false for a concave `shape` (only the coin can be) to
	// switch to the general point-in-polygon containment, so legends can use the
	// whole concave region rather than a conservative inscribed area.
	convex?: boolean;
	// the default Legend for this face (user can change of course)
	defaultLegend: Legend;
	// faces a die should NOT come to rest on, because doing so gives an
	// inconclusive read (e.g. a crystal's blank cap, or a truncated d4's number
	// triangle whose opposite face is blank). The stability check (see
	// $lib/utils/stability.ts) tests every flagged face: if the line from the
	// die's centre of mass to the face plane lands inside the face, the die can
	// physically rest there and a "may land wrong" warning is raised. Most dice
	// leave this undefined; only the handful that can settle ambiguously set it.
	noRest?: boolean;
	transform: Transform; // transform to put the face in position.
	explodeTransform?: Transform; // transfor to put the face in the exploded position
};

// one selectable option of a "toggle" parameter.
export type ParameterOption = {
	// the numeric value stored for this option.
	value: number;
	// i18n key for the option's label, looked up via m.dice_parameter_option().
	label: string;
};

// how a parameter is rendered. omitted/undefined means a plain range slider.
export type ParameterDisplay = {
	kind: 'toggle';
	options: Array<ParameterOption>;
};

// gate a parameter's visibility on the value of another (numeric) parameter.
// e.g. only show the rim-segments slider when the shape-mode toggle is "polygon".
export type VisibleWhen = {
	// the id of the numeric parameter to test.
	param: string;
	// the value it must equal for this parameter to be shown.
	equals: number;
};

export type DiceParameter = {
	id: string; // stable name
	// for a "range" input
	defaultValue: number;
	min: number;
	max: number;
	step: number;
	// optional alternate UI (e.g. a toggle); defaults to a slider when omitted.
	display?: ParameterDisplay;
	// optional visibility gate; shown unconditionally when omitted.
	visibleWhen?: VisibleWhen;
};

// the result of validating a string parameter's value.
export type StringParameterValidation = {
	// whether the value is acceptable (a valid path that builds a usable shape).
	valid: boolean;
	// optional i18n key for a (blocking) error message when invalid.
	error?: string;
	// optional i18n key for a non-blocking warning (e.g. concave shape may engrave
	// poorly) shown even when the value is valid.
	warning?: string;
};

// a string-valued parameter (e.g. a custom SVG path). rendered as a textbox.
export type StringParameter = {
	id: string; // stable name
	defaultValue: string;
	// optional visibility gate; shown unconditionally when omitted.
	visibleWhen?: VisibleWhen;
	// optional live validation used by the UI to flag invalid input / warnings.
	validate?(value: string): StringParameterValidation;
};

export type DieFactory<DieParams extends Record<string, number>> = (params: DieParams) => DieModel;
