// Types shared between the box layout editor component and its host page.
import type { BoxLayoutParams, BoxLayoutShape } from '$lib/box/types';
import type { Vector2, Vector3 } from 'three';

// One die in the 2D layout editor: its rotation-0 hull (rotated live as the user
// spins it), laid-flat size, and current centre position + rotation.
export type EditorItem = {
	dieId: string;
	kind: string;
	hull0: Array<Vector2>;
	size: Vector3;
	x: number;
	y: number;
	rotation: number;
	include: boolean;
};

// What the editor hands back on apply: per-die placement, the chosen box
// half-extents, the auto-arrange layout params (rows/gap/margins), and the
// box-shape params the editor lets you tune live (chamfer/wall/magnets).
export type LayoutResult = {
	placements: Array<{ dieId: string; x: number; y: number; rotation: number; include: boolean }>;
	box: { halfX: number; halfY: number };
	layoutParams: BoxLayoutParams;
	shape: BoxLayoutShape;
};
