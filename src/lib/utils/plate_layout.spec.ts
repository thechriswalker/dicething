import { describe, expect, it } from 'vitest';
import {
	BoxGeometry,
	BufferGeometry,
	Float32BufferAttribute,
	Mesh,
	MeshBasicMaterial,
	Vector3
} from 'three';
import dice from '../dice';
import { BUILD_PLATE_PRESETS, buildPlatePresetGroups } from './build_plates';
import { groupMeshesByCategory, type NamedMesh } from './export';
import { manifold } from './manifold';
import {
	applyPlateLayout,
	partitionForPlates,
	planPlateLayout,
	type PlateMesh
} from './plate_layout';
import { footprintOf, packPolygons, type PackPoly, type Pt } from './plate_pack';
import { computePointDownPrintingTransform } from './printing';

const material = new MeshBasicMaterial();

function box(w: number, d: number, group: string): PlateMesh {
	return { mesh: new Mesh(new BoxGeometry(w, 8, d), material), group };
}

function xzBox(mesh: Mesh) {
	mesh.geometry.computeBoundingBox();
	const box = mesh.geometry.boundingBox!;
	const size = new Vector3();
	const center = new Vector3();
	box.getSize(size);
	box.getCenter(center);
	return {
		minX: box.min.x,
		maxX: box.max.x,
		minZ: box.min.z,
		maxZ: box.max.z,
		cx: center.x,
		cz: center.z,
		sx: size.x,
		sz: size.z
	};
}

function tri(
	index: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number
): PackPoly {
	const pts: Array<Pt> = [
		{ x: ax, y: ay },
		{ x: bx, y: by },
		{ x: cx, y: cy }
	];
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of pts) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return {
		index,
		w: maxX - minX,
		h: maxY - minY,
		hull: pts.map((p) => ({ x: p.x - minX, y: p.y - minY }))
	};
}

function polygonMesh(hull: Array<Pt>): Mesh {
	const positions: Array<number> = [];
	for (let i = 1; i < hull.length - 1; i++) {
		positions.push(
			hull[0].x,
			0,
			hull[0].y,
			hull[i].x,
			0,
			hull[i].y,
			hull[i + 1].x,
			0,
			hull[i + 1].y
		);
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	return new Mesh(geometry, material);
}

function ngon(diameter: number, sides: number): Mesh {
	const radius = diameter / 2;
	const positions: Array<number> = [];
	for (let i = 0; i < sides; i++) {
		const a0 = (i / sides) * Math.PI * 2;
		const a1 = ((i + 1) / sides) * Math.PI * 2;
		positions.push(
			0,
			0,
			0,
			Math.cos(a0) * radius,
			0,
			Math.sin(a0) * radius,
			Math.cos(a1) * radius,
			0,
			Math.sin(a1) * radius
		);
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	return new Mesh(geometry, material);
}

function dieFootprint(kind: keyof typeof dice, params: Record<string, number>): PlateMesh {
	const built = dice[kind].build(params);
	const transform = built.printingTransform ?? computePointDownPrintingTransform(built.faces);
	const positions: Array<number> = [];
	for (const face of built.faces) {
		if (face.hidden) {
			continue;
		}
		for (const p of face.shape.getPoints(2)) {
			const v = transform.applyToVector3(face.transform.applyToVector3(new Vector3(p.x, p.y, 0)));
			positions.push(v.x, v.y, v.z);
		}
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
	return { mesh: new Mesh(geometry, material), group: 'dice' };
}

function worldHull(mesh: Mesh): Array<Pt> {
	return footprintOf(mesh.geometry).hull.map((p) => {
		mesh.geometry.computeBoundingBox();
		const box = mesh.geometry.boundingBox!;
		return { x: p.x + box.min.x, y: p.y + box.min.z };
	});
}

function polyDistance(a: Array<Pt>, b: Array<Pt>): number {
	if (convexOverlap(a, b)) {
		return 0;
	}
	let best = Infinity;
	for (let i = 0; i < a.length; i++) {
		for (let j = 0; j < b.length; j++) {
			best = Math.min(best, segDistance(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
		}
	}
	return best;
}

function convexOverlap(a: Array<Pt>, b: Array<Pt>): boolean {
	return (
		a.some((p) => pointInConvex(p, b)) || b.some((p) => pointInConvex(p, a)) || edgesCross(a, b)
	);
}

function pointInConvex(p: Pt, poly: Array<Pt>): boolean {
	for (let i = 0; i < poly.length; i++) {
		const a = poly[i];
		const b = poly[(i + 1) % poly.length];
		const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
		if (cross < -1e-6) {
			return false;
		}
	}
	return true;
}

function edgesCross(a: Array<Pt>, b: Array<Pt>): boolean {
	for (let i = 0; i < a.length; i++) {
		for (let j = 0; j < b.length; j++) {
			if (segmentsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) {
				return true;
			}
		}
	}
	return false;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
	const cross = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	const ab = cross(a, b, c) * cross(a, b, d);
	const cd = cross(c, d, a) * cross(c, d, b);
	return ab < -1e-8 && cd < -1e-8;
}

function segDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
	return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
}

function pointSeg(p: Pt, a: Pt, b: Pt): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t =
		len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function expectPacked(
	meshes: Array<PlateMesh>,
	plate: { x: number; y: number },
	gap: number,
	margin: number
) {
	const plan = planPlateLayout(meshes, plate, { gap, margin });
	const rects = applyPlateLayout(meshes, plan, 'spread');
	const boxes = meshes.map((m) => xzBox(m.mesh));
	const hulls = meshes.map((m) => worldHull(m.mesh));
	for (let i = 0; i < hulls.length; i++) {
		for (let j = i + 1; j < hulls.length; j++) {
			expect(polyDistance(hulls[i], hulls[j]), `gap ${i} vs ${j}`).toBeGreaterThanOrEqual(
				gap - 0.08
			);
		}
	}
	for (const m of meshes) {
		const p = plan.placements.get(m);
		if (!p || p.plate < 0) {
			continue;
		}
		const b = xzBox(m.mesh);
		const rect = rects[p.plate];
		expect(b.minX).toBeGreaterThanOrEqual(rect.cx - rect.width / 2 - 0.05);
		expect(b.maxX).toBeLessThanOrEqual(rect.cx + rect.width / 2 + 0.05);
		expect(b.minZ).toBeGreaterThanOrEqual(rect.cz - rect.depth / 2 - 0.05);
		expect(b.maxZ).toBeLessThanOrEqual(rect.cz + rect.depth / 2 + 0.05);
	}
	return { plan, rects, boxes };
}

describe('build plate presets', () => {
	it('lists positive sizes and groups them by brand', () => {
		for (const size of Object.values(BUILD_PLATE_PRESETS)) {
			expect(size.x).toBeGreaterThan(0);
			expect(size.y).toBeGreaterThan(0);
		}
		const groups = buildPlatePresetGroups();
		expect(groups.map((g) => g.brand)).toContain('Elegoo');
		expect(groups.map((g) => g.brand)).toContain('Formlabs');
		expect(groups.map((g) => g.brand)).toContain('Anycubic');
		expect(groups.map((g) => g.brand)).toContain('Creality');
		const elegoo = groups.find((g) => g.brand === 'Elegoo')!;
		expect(elegoo.presets.some((p) => p.model === 'Saturn 4 Ultra')).toBe(true);
	});
});

describe('planPlateLayout', () => {
	it('puts every object on one plate when they fit', () => {
		const meshes = [
			box(10, 10, 'dice'),
			box(12, 10, 'dice'),
			box(10, 10, 'blanks'),
			box(10, 14, 'platforms')
		];
		const { plan } = expectPacked(meshes, { x: 120, y: 80 }, 4, 2);
		expect(plan.plateCount).toBe(1);
		expect(plan.overflow).toBe(0);
		expect(new Set([...plan.placements.values()].map((p) => p.plate))).toEqual(new Set([0]));
	});

	it('keeps types on separate plates when they do not all fit together', () => {
		const meshes = [
			...Array.from({ length: 4 }, () => box(40, 40, 'dice')),
			...Array.from({ length: 4 }, () => box(40, 40, 'blanks'))
		];
		// Usable area is 96×96, which holds four 40 mm squares and not eight.
		const { plan } = expectPacked(meshes, { x: 100, y: 100 }, 4, 2);
		expect(plan.plateCount).toBe(2);
		expect(plan.overflow).toBe(0);
		const platesByGroup = new Map<string, Set<number>>();
		for (const m of meshes) {
			const p = plan.placements.get(m)!;
			let set = platesByGroup.get(m.group);
			if (!set) {
				set = new Set();
				platesByGroup.set(m.group, set);
			}
			set.add(p.plate);
		}
		expect(platesByGroup.get('dice')!.size).toBe(1);
		expect(platesByGroup.get('blanks')!.size).toBe(1);
		expect([...platesByGroup.get('dice')!][0]).not.toBe([...platesByGroup.get('blanks')!][0]);
	});

	it('spreads one type evenly when it needs more than one plate', () => {
		const meshes = Array.from({ length: 6 }, () => box(40, 40, 'dice'));
		const { plan } = expectPacked(meshes, { x: 100, y: 100 }, 4, 2);
		expect(plan.plateCount).toBe(2);
		const counts = [0, 0];
		for (const m of meshes) {
			counts[plan.placements.get(m)!.plate]++;
		}
		expect(counts).toEqual([3, 3]);
	});

	it('packs rectangles that do not fit in simple rows', () => {
		const meshes = [box(60, 60, 'dice'), box(60, 40, 'dice'), box(40, 60, 'dice')];
		const { plan } = expectPacked(meshes, { x: 100, y: 100 }, 0, 0);
		expect(plan.plateCount).toBe(1);
		expect(plan.overflow).toBe(0);
	});

	it('yaws a long footprint onto its side when that is the only way it fits', () => {
		const meshes = [box(80, 20, 'dice')];
		const plan = planPlateLayout(meshes, { x: 50, y: 100 }, { gap: 0, margin: 0 });
		expect(plan.overflow).toBe(0);
		expect(plan.placements.get(meshes[0])!.rotated).toBe(true);
		applyPlateLayout(meshes, plan, 'perPlate');
		const b = xzBox(meshes[0].mesh);
		expect(b.sx).toBeCloseTo(20, 3);
		expect(b.sz).toBeCloseTo(80, 3);
		// perPlate centres the plate on the origin.
		expect(b.minX).toBeGreaterThanOrEqual(-25.05);
		expect(b.maxX).toBeLessThanOrEqual(25.05);
		expect(b.minZ).toBeGreaterThanOrEqual(-50.05);
		expect(b.maxZ).toBeLessThanOrEqual(50.05);
	});

	it('reports objects larger than the plate instead of forcing them on', () => {
		const meshes = [box(200, 200, 'dice'), box(10, 10, 'dice')];
		const { plan } = expectPacked(meshes, { x: 100, y: 100 }, 4, 2);
		expect(plan.overflow).toBe(1);
		expect(plan.plateCount).toBe(1);
		expect(plan.placements.get(meshes[0])!.plate).toBe(-1);
		expect(plan.placements.get(meshes[1])!.plate).toBe(0);
	});

	it('nests round footprints that do not fit as bounding boxes', () => {
		// A 22 mm dodecagon's box only tiles 5×2 on a Mars 5 Ultra once the gap
		// and margin are in, so twelve of them spill onto a second plate. The
		// silhouettes stagger and stay on one.
		const meshes = Array.from({ length: 12 }, () => ({
			mesh: ngon(22, 12),
			group: 'dice'
		}));
		const plate = { x: 153.36, y: 77.76 };
		const gap = 4;
		const { plan, rects } = expectPacked(meshes, plate, gap, 2);
		expect(plan.plateCount).toBe(1);
		expect(plan.overflow).toBe(0);
		const hulls = meshes.map((m) => worldHull(m.mesh));
		for (let i = 0; i < hulls.length; i++) {
			for (let j = i + 1; j < hulls.length; j++) {
				expect(polyDistance(hulls[i], hulls[j])).toBeGreaterThanOrEqual(gap - 0.08);
			}
			const rect = rects[0];
			for (const p of hulls[i]) {
				expect(p.x).toBeGreaterThanOrEqual(rect.cx - rect.width / 2 - 0.08);
				expect(p.x).toBeLessThanOrEqual(rect.cx + rect.width / 2 + 0.08);
				expect(p.y).toBeGreaterThanOrEqual(rect.cz - rect.depth / 2 - 0.08);
				expect(p.y).toBeLessThanOrEqual(rect.cz + rect.depth / 2 + 0.08);
			}
		}
	});

	it('fits a near miss after swapping the piece that did not fit', () => {
		// Size sorts never try this order, and bottom-left rejects it. Moving
		// the piece that sticks out finds a packing of the same outlines.
		const shapes = [
			tri(0, 0, 0, 34, 0, 8, 22),
			tri(1, 0, 0, 30, 0, 30, 18),
			tri(2, 0, 0, 26, 4, 4, 24),
			tri(3, 0, 0, 22, 0, 22, 20),
			tri(4, 0, 0, 18, 0, 6, 20)
		];
		expect(packPolygons(shapes, 70, 36, 2, true, false)).toBeNull();
		const meshes = shapes.map((shape) => ({
			mesh: polygonMesh(shape.hull),
			group: 'dice'
		}));
		const { plan } = expectPacked(meshes, { x: 70, y: 36 }, 2, 0);
		expect(plan.plateCount).toBe(1);
		expect(plan.overflow).toBe(0);
	});

	it('keeps twelve point-down d20s on one Mars 5 Ultra plate', () => {
		const meshes = Array.from({ length: 12 }, () =>
			dieFootprint('d20_icosahedron', { polyhedron_size: 20 })
		);
		const { plan } = expectPacked(meshes, { x: 153.36, y: 77.76 }, 4, 2);
		expect(plan.plateCount).toBe(1);
		expect(plan.overflow).toBe(0);
	});

	it('rotates the manifold solid with the preview mesh', () => {
		const wasm = manifold();
		const meshes: Array<PlateMesh> = [
			{
				mesh: new Mesh(new BoxGeometry(80, 10, 20), material),
				group: 'dice',
				manifold: wasm.Manifold.cube([80, 10, 20], true)
			}
		];
		const plan = planPlateLayout(meshes, { x: 50, y: 100 }, { gap: 0, margin: 0 });
		applyPlateLayout(meshes, plan, 'perPlate');
		const geo = xzBox(meshes[0].mesh);
		const placed = meshes[0].manifold!;
		const bb = placed.boundingBox();
		expect(bb.min[0]).toBeCloseTo(geo.minX, 3);
		expect(bb.max[0]).toBeCloseTo(geo.maxX, 3);
		expect(bb.min[2]).toBeCloseTo(geo.minZ, 3);
		expect(bb.max[2]).toBeCloseTo(geo.maxZ, 3);
		placed.delete();
	});
});

describe('partitionForPlates', () => {
	it('splits a category that spans plates and leaves a single-plate category whole', () => {
		const items = [
			{ group: 'dice', plate: 0 },
			{ group: 'blanks', plate: 2 },
			{ group: 'dice', plate: 1 },
			{ group: 'platforms', plate: -1 }
		];
		expect(partitionForPlates(items, (it) => it.plate).map((p) => p.key)).toEqual([
			'dice_plate1',
			'dice_plate2',
			'blanks',
			'platforms_overflow'
		]);
	});

	it('names 3MF groups per plate when a category is split', () => {
		const named = [
			{ name: 'a', group: 'dice', mesh: box(1, 1, 'dice').mesh },
			{ name: 'b', group: 'dice', mesh: box(1, 1, 'dice').mesh },
			{ name: 'c', group: 'blanks', mesh: box(1, 1, 'blanks').mesh }
		] as unknown as Array<NamedMesh>;
		const plates = [0, 1, 2];
		const groups = groupMeshesByCategory(named, 'set', (n) => plates[named.indexOf(n)]);
		expect(groups.map((g) => g.name)).toEqual(['set_dice_plate1', 'set_dice_plate2', 'set_blanks']);
		expect(groups[0].meshes).toEqual([named[0]]);
		expect(groups[1].meshes).toEqual([named[1]]);
	});
});
