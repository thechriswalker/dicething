import type { Legend } from '$lib/utils/legends';
import type { BufferGeometry, Shape, Vector2 } from 'three';

export type DieModel = {
	id: string; // stable name for serialisation
	parameters: Array<DiceParameter>;
	// name of this dice type
	name: string;
	// create a "blank" from the parameters
	build(params: Record<string, number>): {
		faces: Array<DieFaceModel>;
		faceToFaceDistance: number;
	};
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
	// the convex outer shape for this face
	shape: Shape;
	// the default Legend for this face (user can change of course)
	defaultLegend: Legend;
	// a function to orient an origin-centered, +Z-facing mesh from the
	// shape (might be engraved) to the correct position in 3D.
	orient(geo: BufferGeometry): void;
};

export type DiceParameter = {
	id: string; // stable name
	name: string; // human/translatable name
	description: string; // long description
	// for a "range" input
	defaultValue: number;
	min: number;
	max: number;
	step: number;
};

export type DieFactory<DieParams extends Record<string, number>> = (params: DieParams) => DieModel;
