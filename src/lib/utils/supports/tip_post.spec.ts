import { describe, expect, it } from 'vitest';
import { CubeD6 } from '$lib/dice/cube';
import { TrapezohedronD8 } from '$lib/dice/trapezohedrons';
import { computePointDownPrintingTransform } from '../printing';
import { checkIndexedMesh } from '../mesh_check';
import { manifoldToIndexedMesh } from '../manifold';
import { detectTipPost } from './regions';
import { buildTipPostManifold } from './tip_post';
import { DEFAULT_SUPPORT_SETTINGS } from './types';

describe('tip post', () => {
	it('finds a 3-fin tip on a tip-down cube', () => {
		const faces = CubeD6.build({ polyhedron_size: 16 }).faces;
		const printT = computePointDownPrintingTransform(faces);
		const tip = detectTipPost(faces, printT);
		expect(tip).toBeDefined();
		expect(tip!.edgeDirs.length).toBe(3);
		expect(tip!.apex.y).toBeGreaterThan(0);
	});

	it('finds a 4-fin tip on a tip-down d8 trapezohedron', () => {
		const faces = TrapezohedronD8.build({
			trapezohedron_radius: 14,
			trapezohedron_height: 36
		}).faces;
		const printT = computePointDownPrintingTransform(faces);
		const tip = detectTipPost(faces, printT);
		expect(tip).toBeDefined();
		expect(tip!.edgeDirs.length).toBe(4);
	});

	it('builds a watertight tip-post manifold', () => {
		const faces = CubeD6.build({ polyhedron_size: 16 }).faces;
		const printT = computePointDownPrintingTransform(faces);
		const tip = detectTipPost(faces, printT)!;
		const man = buildTipPostManifold(tip, DEFAULT_SUPPORT_SETTINGS);
		const { positions, indices } = manifoldToIndexedMesh(man);
		const report = checkIndexedMesh(positions, indices);
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		man.delete();
	});
});
