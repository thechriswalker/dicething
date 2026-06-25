import { BufferGeometry, Float32BufferAttribute, Mesh, MeshNormalMaterial, Shape, Vector2 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { m } from '$lib/paraglide/messages';
import type { Builder } from '../builder';
import { getAreaOfShapeAtOrigin } from '../shapes';
import { controlValue, type ExtraBuildOption } from './types';

const _material = new MeshNormalMaterial();

const controls: ExtraBuildOption['controls'] = [
	{
		id: 'inset',
		kind: 'number',
		label: m.export_opt_platforms_inset_label,
		min: 0,
		max: 10,
		step: 0.1,
		default: 1.5,
		unit: m.export_unit_mm,
		help: m.export_opt_platforms_inset_help
	},
	{
		id: 'height',
		kind: 'number',
		label: m.export_opt_platforms_height_label,
		min: 0.5,
		max: 6,
		step: 0.1,
		default: 2,
		unit: m.export_unit_mm
	},
	{
		id: 'angle',
		kind: 'number',
		label: m.export_opt_platforms_angle_label,
		// steep draft so the base is only slightly wider than the top.
		min: 45,
		max: 85,
		step: 1,
		default: 65,
		unit: m.export_unit_deg,
		help: m.export_opt_platforms_angle_help
	}
];

export const platformsOption: ExtraBuildOption = {
	id: 'platforms',
	label: m.export_opt_platforms_label,
	description: m.export_opt_platforms_description,
	defaultEnabled: false,
	controls,
	generate(ctx) {
		const inset = Number(controlValue(controls, ctx.values, 'inset')) || 0;
		const height = Number(controlValue(controls, ctx.values, 'height')) || 2;
		const angleDeg = Number(controlValue(controls, ctx.values, 'angle')) || 65;

		const shape = ctx.model.platformShape?.(ctx.die.parameters) ?? largestFaceShape(ctx.builder);
		if (!shape) {
			return [];
		}
		const geo = buildPlatform(shape, { height, inset, angleDeg });
		return [{ suffix: 'platform', mesh: new Mesh(geo, _material) }];
	}
};

function largestFaceShape(builder: Builder): Shape | undefined {
	let best: Shape | undefined;
	let bestArea = -Infinity;
	for (const f of builder.getFaces()) {
		const area = getAreaOfShapeAtOrigin(f.shape);
		if (area > bestArea) {
			bestArea = area;
			best = f.shape;
		}
	}
	return best;
}

// Build a drafted truncated-cone ("frustum") pedestal, defined top-down: the
// top surface (the important one) is `shape` inset inward by `inset` and sits at
// y=height; from there the walls extrude down and outward at `angleDeg` for
// `height`, so the base (at y=0) is wider than the top by height / tan(angle) on
// every edge. `shape` is expected to be a convex polygon centered near origin.
export function buildPlatform(
	shape: Shape,
	{ height, inset, angleDeg }: { height: number; inset: number; angleDeg: number }
): BufferGeometry {
	const face = polygonPoints(shape);
	const n = face.length;
	if (n < 3) {
		return new BufferGeometry();
	}
	// normalize to CCW (in 2D x,y) so the side-wall and cap winding below is
	// consistent regardless of the orientation the source shape happened to use.
	if (signedArea(face) < 0) {
		face.reverse();
	}
	// horizontal growth from the top down to the base.
	const run = height / Math.tan((angleDeg * Math.PI) / 180);
	// top is the face inset by `inset`; base is the top grown outward by `run`
	// (equivalently the face inset by `inset - run`, where a negative inset is an
	// outset).
	const top = offsetConvexInward(face, inset);
	const base = offsetConvexInward(face, inset - run);

	const positions: number[] = [];
	const push = (p: Vector2, y: number) => positions.push(p.x, y, p.y);

	// side walls: one quad per edge, split into two triangles. wound so the
	// outward face points away from the centroid.
	for (let i = 0; i < n; i++) {
		const j = (i + 1) % n;
		// triangle 1: base[i], top[i], base[j]
		push(base[i], 0);
		push(top[i], height);
		push(base[j], 0);
		// triangle 2: base[j], top[i], top[j]
		push(base[j], 0);
		push(top[i], height);
		push(top[j], height);
	}

	// bottom cap (normal points down): fan from vertex 0. for a CCW (x,y)
	// polygon, the natural fan order winds the down-facing normal correctly.
	for (let i = 1; i < n - 1; i++) {
		push(base[0], 0);
		push(base[i], 0);
		push(base[i + 1], 0);
	}

	// top cap (normal points up): fan from vertex 0, reversed winding.
	for (let i = 1; i < n - 1; i++) {
		push(top[0], height);
		push(top[i + 1], height);
		push(top[i], height);
	}

	const geo = new BufferGeometry();
	geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
	const merged = mergeVertices(geo);
	merged.computeVertexNormals();
	return merged;
}

// Signed area of a 2D polygon. Positive => CCW, negative => CW.
function signedArea(points: Array<Vector2>): number {
	let area = 0;
	const n = points.length;
	for (let i = 0; i < n; i++) {
		const a = points[i];
		const b = points[(i + 1) % n];
		area += a.x * b.y - b.x * a.y;
	}
	return area / 2;
}

// Get the polygon vertices of a (convex) shape, dropping a duplicated closing
// point if present.
function polygonPoints(shape: Shape): Array<Vector2> {
	const pts = shape.getPoints(24).map((p) => p.clone());
	if (pts.length > 1) {
		const first = pts[0];
		const last = pts[pts.length - 1];
		if (Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) {
			pts.pop();
		}
	}
	return pts;
}

// Offset a convex polygon inward by `inset` (perpendicular distance on every
// edge), by mitering offset edges at each vertex. Approximate but exact for
// convex polygons.
function offsetConvexInward(points: Array<Vector2>, inset: number): Array<Vector2> {
	const n = points.length;
	const centroid = new Vector2();
	for (const p of points) centroid.add(p);
	centroid.divideScalar(n);

	// per-edge offset line: a point on it + its direction.
	const edges = points.map((a, i) => {
		const b = points[(i + 1) % n];
		const dir = b.clone().sub(a).normalize();
		// inward normal (toward centroid)
		let normal = new Vector2(-dir.y, dir.x);
		const mid = a.clone().add(b).multiplyScalar(0.5);
		if (normal.dot(centroid.clone().sub(mid)) < 0) {
			normal = normal.negate();
		}
		const point = a.clone().add(normal.clone().multiplyScalar(inset));
		return { point, dir };
	});

	// new vertex i = intersection of offset edge (i-1) and offset edge i.
	const out: Array<Vector2> = [];
	for (let i = 0; i < n; i++) {
		const prev = edges[(i - 1 + n) % n];
		const cur = edges[i];
		const v = lineIntersection(prev.point, prev.dir, cur.point, cur.dir);
		out.push(v ?? points[i].clone().lerp(centroid, 0.1));
	}
	return out;
}

// Intersection of two lines given as point + direction. Returns undefined when
// (near) parallel.
function lineIntersection(p1: Vector2, d1: Vector2, p2: Vector2, d2: Vector2): Vector2 | undefined {
	const denom = d1.x * d2.y - d1.y * d2.x;
	if (Math.abs(denom) < 1e-9) {
		return undefined;
	}
	const dx = p2.x - p1.x;
	const dy = p2.y - p1.y;
	const t = (dx * d2.y - dy * d2.x) / denom;
	return new Vector2(p1.x + d1.x * t, p1.y + d1.y * t);
}
