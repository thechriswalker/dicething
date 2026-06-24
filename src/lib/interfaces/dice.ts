import type { Transform } from '$lib/utils/3d';
import type { Legend } from '$lib/utils/legends';
import type { Shape, Vector2 } from 'three';

export type DieTags = {
	kind: string; // broad shape family, e.g. "polyhedron", "trapezohedron"
	variant?: string; // optional sub-shape, e.g. "rhombic", "cube"
	sides: string; // "2".."20", and "00" for d%
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
	// create a "blank" from the parameters
	build(params: Record<string, number>): {
		faces: Array<DieFaceModel>;
		faceToFaceDistance: number;

		// some dice beenfit from explicitly sizing the symbols for each face.
		// if this flag is set, the builder will size each face specifically for it's legend
		// otherwise, we'll find the biggest fit for each face, but scale all legends evenly
		sizeLegendsIndividually?: boolean;

		// how to transform the model for printing
		// the model is usually centered on the origin, so this will be a rotation
		// to move the object to the correct orientation and then a y translation to
		// raise the object so the tip is on the xz plane.
		// this is the orientation we want to use to print, keeping all dice on the same level, for when / if they are grouped.
		// optional: when omitted the exporter treats it as the identity (no-op).
		printingTransform?: Transform;
	};
	// create parameters for building a blank using the "build" function that is
	// offset from the given parameters by `offset`.
	// note that offset could be positive or negative - as people might want "inverse"
	// blanks that are bigger than the numbered dice and shell smooth or regular
	// ones that are smaller than the regular ones and shell to the same size as regular.
	// either way, the offset should be at least your engraving depth + wiggle room.
	blankParameters?(params: Record<string, number>, offset: number): Record<string, number>;
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
	// the convex outer shape for this face
	shape: Shape;
	// the default Legend for this face (user can change of course)
	defaultLegend: Legend;
	transform: Transform; // transform to put the face in position.
	explodeTransform?: Transform; // transfor to put the face in the exploded position
};

export type DiceParameter = {
	id: string; // stable name
	// for a "range" input
	defaultValue: number;
	min: number;
	max: number;
	step: number;
};

export type DieFactory<DieParams extends Record<string, number>> = (params: DieParams) => DieModel;
