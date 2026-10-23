import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { RoundedD6 } from './rounded_cube';
import { assembleBlankExportShellGeometry } from '$lib/utils/die_manifold';
import { checkMesh } from '$lib/utils/mesh_check';
import { geometryToManifold, toFlatPositions } from '$lib/utils/manifold';

function shellReport(params: Record<string, number>) {
	const built = RoundedD6.build(params);
	const shell = assembleBlankExportShellGeometry(built.faces);
	const report = checkMesh(toFlatPositions(shell));
	const man = geometryToManifold(shell);
	const status = man.status();
	const volume = status === 'NoError' ? man.volume() : 0;
	man.delete();
	shell.dispose();
	return { built, report, status, volume };
}

describe('rounded d6', () => {
	it('has six number faces in cube order', () => {
		const built = RoundedD6.build({});
		const numbers = built.faces.filter((f) => f.isNumberFace);
		expect(numbers).toHaveLength(6);
		expect(numbers.map((f) => f.defaultLegend)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(built.faceToFaceDistance).toBeCloseTo(18, 6);
	});

	it('places opposite faces face-to-face apart', () => {
		const built = RoundedD6.build({ rounded_size: 18, rounded_corner: 3, rounded_edge: 2.5 });
		const centers = built.faces
			.filter((f) => f.isNumberFace)
			.map((f) => f.transform.applyToVector3(new Vector3()));
		// 1 opposite 6, 2 opposite 5, 3 opposite 4
		for (const [a, b] of [
			[0, 5],
			[1, 4],
			[2, 3]
		]) {
			expect(centers[a].clone().add(centers[b]).length()).toBeLessThan(1e-6);
			expect(centers[a].distanceTo(centers[b])).toBeCloseTo(18, 5);
		}
	});

	it.each([
		['default', {}],
		['square faces', { rounded_corner: 0, rounded_edge: 2.5 }],
		['sharp edges', { rounded_corner: 3, rounded_edge: 0 }],
		['sharp cube', { rounded_corner: 0, rounded_edge: 0 }],
		['circular faces', { rounded_size: 18, rounded_corner: 20, rounded_edge: 2 }],
		['heavy fillet', { rounded_size: 16, rounded_corner: 1, rounded_edge: 6 }]
	])('exports a closed manifold (%s)', (_label, params) => {
		const { report, status, volume } = shellReport(params);
		expect(status).toBe('NoError');
		expect(volume).toBeGreaterThan(0);
		expect(report.boundaryEdgeCount, JSON.stringify(report)).toBe(0);
		expect(report.nonManifoldEdgeCount).toBe(0);
		expect(report.degenerateTriangleCount).toBe(0);
		expect(report.duplicateTriangleCount).toBe(0);
		expect(report.isPrintable).toBe(true);
	});

	it('fillets inside the face-to-face cube and hits the 45° edge', () => {
		const built = RoundedD6.build({ rounded_size: 18, rounded_corner: 3, rounded_edge: 2.5 });
		const shell = assembleBlankExportShellGeometry(built.faces);
		const pos = shell.getAttribute('position');
		let maxAbs = 0;
		let nearestFillet = Infinity;
		// Middle of the straight +X/+Z fillet, at 45°. The corner blend eases
		// off before it reaches this far, so the quarter-circle is exact here.
		const fillet = new Vector3(6.5 + 2.5 / Math.SQRT2, 0, 6.5 + 2.5 / Math.SQRT2);
		for (let i = 0; i < pos.count; i++) {
			const p = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
			maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
			nearestFillet = Math.min(nearestFillet, p.distanceTo(fillet));
		}
		shell.dispose();
		expect(maxAbs).toBeCloseTo(9, 4);
		expect(nearestFillet).toBeLessThan(1e-4);
		const face = built.faces.find((f) => f.isNumberFace)!;
		const outline = face.shape.getPoints(1);
		const maxX = Math.max(...outline.map((p) => p.x));
		expect(maxX).toBeCloseTo(6.5, 4);
		// The flat face's corner is rounded, so (s, s) is not on the outline.
		const sharpCorner = outline.some((p) => Math.hypot(p.x - 6.5, p.y - 6.5) < 1e-3);
		expect(sharpCorner).toBe(false);
	});

	it('blends the corner into each edge without a ridge', () => {
		const built = RoundedD6.build({ rounded_size: 18, rounded_corner: 3, rounded_edge: 2.5 });
		const shell = assembleBlankExportShellGeometry(built.faces);
		const pos = shell.getAttribute('position');
		const tris: Array<{ p: [Vector3, Vector3, Vector3]; n: Vector3; alt: number }> = [];
		for (let i = 0; i < pos.count; i += 3) {
			const p: [Vector3, Vector3, Vector3] = [
				new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)),
				new Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1)),
				new Vector3(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2))
			];
			const cross = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]));
			const area = cross.length();
			if (area < 1e-8) {
				continue;
			}
			const n = cross.multiplyScalar(1 / area);
			if (n.dot(p[0]) < 0) {
				n.negate();
			}
			const longest = Math.max(p[0].distanceTo(p[1]), p[1].distanceTo(p[2]), p[2].distanceTo(p[0]));
			tris.push({ p, n, alt: longest < 1e-9 ? 0 : area / longest });
		}
		const key = (v: Vector3) =>
			`${Math.round(v.x * 1e4)},${Math.round(v.y * 1e4)},${Math.round(v.z * 1e4)}`;
		const edges = new Map<string, { mid: Vector3; tris: Array<number> }>();
		for (let ti = 0; ti < tris.length; ti++) {
			for (let e = 0; e < 3; e++) {
				const a = tris[ti].p[e];
				const b = tris[ti].p[(e + 1) % 3];
				const k = [key(a), key(b)].sort().join('|');
				const entry = edges.get(k) ?? { mid: a.clone().add(b).multiplyScalar(0.5), tris: [] };
				entry.tris.push(ti);
				edges.set(k, entry);
			}
		}
		// +++ corner, past the straight fillet (s - rf = 3.5). Thin slivers sit on
		// the sphere but their plane normal is noise; only facets tall enough to
		// read as a crease count here. The slivers are shaded with the sphere normal.
		let worst = 0;
		for (const { mid, tris: pair } of edges.values()) {
			if (pair.length !== 2 || mid.x < 4 || mid.y < 4 || mid.z < 4) {
				continue;
			}
			if (tris[pair[0]].alt < 0.4 || tris[pair[1]].alt < 0.4) {
				continue;
			}
			const dot = Math.min(1, Math.max(-1, tris[pair[0]].n.dot(tris[pair[1]].n)));
			worst = Math.max(worst, (Math.acos(dot) * 180) / Math.PI);
		}
		let cornerReach = 0;
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const y = pos.getY(i);
			const z = pos.getZ(i);
			if (x > 4 && y > 4 && z > 4) {
				cornerReach = Math.max(cornerReach, x + y + z);
			}
		}
		shell.dispose();
		expect(worst).toBeLessThan(15);
		// Outermost point of the spherical corner. 3√2 + 2.5 ≈ 6.74 from (3.5, 3.5, 3.5)
		// along (1,1,1) lands near a coordinate sum of 22.2.
		expect(cornerReach).toBeGreaterThan(21.5);

		const O = new Vector3(3.5, 3.5, 3.5);
		const sphereR = 3 * Math.SQRT2 + 2.5;
		const cornersOf = (
			shape: { getPoints: (n: number) => Array<{ x: number; y: number }> },
			transform: { applyToVector3: (v: Vector3) => Vector3 }
		) => {
			const out: Array<Vector3> = [];
			for (const p of shape.getPoints(1)) {
				const w = transform.applyToVector3(new Vector3(p.x, p.y, 0));
				if (out.some((q) => q.distanceTo(w) < 1e-5)) {
					continue;
				}
				out.push(w);
			}
			return out;
		};
		const hidden = built.faces.filter((f) => f.hidden);
		const corners = hidden.map((f) => cornersOf(f.shape, f.transform));
		const faceEdges = new Map<string, { mid: Vector3; faces: Array<number> }>();
		let shadedInCorner = 0;
		for (let i = 0; i < hidden.length; i++) {
			const c = corners[i];
			if (c.length < 3) {
				continue;
			}
			const mid = c[0]
				.clone()
				.add(c[1])
				.add(c[2])
				.multiplyScalar(1 / 3);
			const shade = hidden[i].shadeCenter;
			if (shade && mid.x > 4 && mid.y > 4 && mid.z > 4) {
				shadedInCorner++;
				expect(shade.distanceTo(O)).toBeLessThan(1e-6);
				for (const p of c) {
					expect(Math.abs(p.distanceTo(O) - sphereR)).toBeLessThan(5e-4);
				}
			}
			for (let e = 0; e < c.length; e++) {
				const a = c[e];
				const b = c[(e + 1) % c.length];
				const k = [key(a), key(b)].sort().join('|');
				const entry = faceEdges.get(k) ?? {
					mid: a.clone().add(b).multiplyScalar(0.5),
					faces: []
				};
				entry.faces.push(i);
				faceEdges.set(k, entry);
			}
		}
		expect(shadedInCorner).toBeGreaterThan(20);
		for (const { mid, faces: pair } of faceEdges.values()) {
			if (pair.length !== 2 || mid.x < 4 || mid.y < 4 || mid.z < 4) {
				continue;
			}
			const n0 = hidden[pair[0]].shadeCenter;
			const n1 = hidden[pair[1]].shadeCenter;
			if (!n0 || !n1) {
				continue;
			}
			// Shared vertices on one sphere get the same shading normal, so the
			// pinched corner does not shade as three ridges out to the edges.
			expect(n0.distanceTo(n1)).toBeLessThan(1e-6);
		}
	});

	it('keeps a blank inset manifold', () => {
		const params = { rounded_size: 18, rounded_corner: 3, rounded_edge: 2.5 };
		const blank = RoundedD6.blankParameters(params, 0.6);
		expect(blank.rounded_size).toBeCloseTo(16.8, 6);
		expect(blank.rounded_edge).toBeCloseTo(1.9, 6);
		expect(blank.rounded_corner).toBe(3);
		const { built, report } = shellReport(blank);
		expect(built.faceToFaceDistance).toBeCloseTo(16.8, 5);
		expect(report.isPrintable).toBe(true);
	});
});
