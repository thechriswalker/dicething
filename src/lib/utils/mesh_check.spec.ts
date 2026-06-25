import { describe, it, expect } from 'vitest';
import { checkMesh, mergeMeshReports } from './mesh_check';

// flat non-indexed position buffer (9 numbers per triangle) for a closed
// tetrahedron: 4 faces, every edge shared by exactly two triangles.
function tetrahedron(): number[] {
	const a = [0, 0, 0];
	const b = [1, 0, 0];
	const c = [0, 1, 0];
	const d = [0, 0, 1];
	const tri = (p: number[], q: number[], r: number[]) => [...p, ...q, ...r];
	return [...tri(a, c, b), ...tri(a, b, d), ...tri(a, d, c), ...tri(b, c, d)];
}

describe('checkMesh', () => {
	it('reports a closed tetrahedron as a printable, watertight, manifold solid', () => {
		const report = checkMesh(tetrahedron());
		expect(report.triangleCount).toBe(4);
		expect(report.boundaryEdgeCount).toBe(0);
		expect(report.nonManifoldEdgeCount).toBe(0);
		expect(report.degenerateTriangleCount).toBe(0);
		expect(report.duplicateTriangleCount).toBe(0);
		expect(report.isManifold).toBe(true);
		expect(report.isWatertight).toBe(true);
		expect(report.isPrintable).toBe(true);
	});

	it('flags an open mesh (single triangle) as not watertight', () => {
		const report = checkMesh([0, 0, 0, 1, 0, 0, 0, 1, 0]);
		expect(report.boundaryEdgeCount).toBe(3);
		expect(report.isWatertight).toBe(false);
		expect(report.isManifold).toBe(true); // no edge is shared by >2 triangles
		expect(report.isPrintable).toBe(false);
	});

	it('detects a degenerate triangle (two coincident corners)', () => {
		const report = checkMesh([0, 0, 0, 1, 0, 0, 1, 0, 0]);
		expect(report.degenerateTriangleCount).toBe(1);
		expect(report.isPrintable).toBe(false);
	});

	it('does not flag a thin sliver with three distinct corners as degenerate', () => {
		// Near-collinear corners but all distinct (well beyond the weld tolerance):
		// this is a valid, if thin, face. Its three real edges read as boundaries
		// here only because the triangle stands alone; in a closed mesh they balance
		// with neighbours. Crucially it must NOT be counted as degenerate, otherwise
		// a sub-micron engraving sliver would flip a closed solid open depending on
		// where it lands in the export layout.
		const report = checkMesh([0, 0, 0, 1, 0, 0, 2, 1e-5, 0]);
		expect(report.degenerateTriangleCount).toBe(0);
		expect(report.boundaryEdgeCount).toBe(3);
	});

	it('detects duplicate triangles and the non-manifold edges they create', () => {
		const verts = tetrahedron();
		const dupedFace = verts.slice(0, 9); // repeat the first face
		const report = checkMesh([...verts, ...dupedFace]);
		expect(report.duplicateTriangleCount).toBe(1);
		expect(report.nonManifoldEdgeCount).toBeGreaterThan(0);
		expect(report.isManifold).toBe(false);
		expect(report.isPrintable).toBe(false);
	});

	it('welds coincident corners within tolerance so seams are not seen as holes', () => {
		// the same tetrahedron, but each face's corners are nudged by sub-tolerance
		// noise (as float ULPs would do) - it must still read as watertight.
		const noisy = tetrahedron().map((v) => v + (Math.random() - 0.5) * 1e-6);
		const report = checkMesh(noisy, { tolerance: 1e-4 });
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
	});

	it('welds within tolerance regardless of absolute position (regression: laid-out die)', () => {
		// Each shared corner carries a per-face copy that differs by a fixed
		// sub-tolerance amount (as the hard-edge seams of a real die do). The weld
		// must hold at every translation - otherwise a closed die that checks out
		// at the origin reports boundary edges the moment it is laid out next to
		// another die (translated into its grid cell).
		const base = tetrahedron();
		// deterministic jitter in [-3e-5, 3e-5], well under the 1e-4 weld tolerance.
		const jittered = base.map((v, i) => v + (((i * 37) % 7) - 3) * 1e-5);
		for (const shift of [0, 0.12345, 0.5, -7.3331, 13.7, 100.001]) {
			const moved = jittered.map((v, i) => (i % 3 === 0 ? v + shift : v));
			const report = checkMesh(moved, { tolerance: 1e-4 });
			expect(report.isWatertight, `watertight at x+${shift}`).toBe(true);
			expect(report.isManifold, `manifold at x+${shift}`).toBe(true);
		}
	});

	it('collects problem-triangle positions when asked', () => {
		const report = checkMesh([0, 0, 0, 1, 0, 0, 1, 0, 0], { collectBad: true });
		expect(report.badPositions).toBeInstanceOf(Float32Array);
		expect(report.badPositions?.length).toBe(9);
	});
});

describe('mergeMeshReports', () => {
	it('sums counts and ANDs the health flags across meshes', () => {
		const good = checkMesh(tetrahedron());
		const bad = checkMesh([0, 0, 0, 1, 0, 0, 0, 1, 0]); // open
		const merged = mergeMeshReports([good, bad]);
		expect(merged.triangleCount).toBe(good.triangleCount + bad.triangleCount);
		expect(merged.boundaryEdgeCount).toBe(bad.boundaryEdgeCount);
		expect(merged.isWatertight).toBe(false);
		expect(merged.isPrintable).toBe(false);
	});
});
