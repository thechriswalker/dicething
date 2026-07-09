import {
	BufferGeometry,
	Float32BufferAttribute,
	Mesh,
	MeshNormalMaterial,
	Shape,
	ShapeUtils,
	Vector2
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { m } from '$lib/paraglide/messages';
import { buildPlatformViaCrossSection } from '../die_manifold';
import { manifold } from '../manifold';
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
		id: 'outset',
		kind: 'number',
		label: m.export_opt_platforms_outset_label,
		min: 0,
		max: 10,
		step: 0.1,
		default: 0.5,
		unit: m.export_unit_mm,
		help: m.export_opt_platforms_outset_help
	},
	{
		id: 'height',
		kind: 'number',
		label: m.export_opt_platforms_height_label,
		min: 0.5,
		max: 6,
		step: 0.1,
		default: 2.5,
		unit: m.export_unit_mm
	}
];

export const platformsOption: ExtraBuildOption = {
	id: 'platforms',
	label: m.export_opt_platforms_label,
	description: m.export_opt_platforms_description,
	defaultEnabled: false,
	controls,
	generate(ctx) {
		const inset = Number(controlValue(controls, ctx.values, 'inset')) || 1.5;
		const outset = Number(controlValue(controls, ctx.values, 'outset')) || 0.5;
		const height = Number(controlValue(controls, ctx.values, 'height')) || 2.5;

		const shape = ctx.model.platformShape?.(ctx.die.parameters) ?? largestFaceShape(ctx.builder);
		if (!shape) {
			return [];
		}
		const geo = buildPlatform(shape, { height, inset, outset });
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

// Build a drafted pedestal under a die face: a short solid whose top surface
// (the important one) is the face pulled in by `inset`, and whose base is the
// face pushed out by `outset`, separated vertically by `height`.
//
// The top/base profiles are produced by uniformly SCALING the face about its
// centroid, not by a perpendicular polygon offset. Scaling can never make a
// simple polygon self-intersect, so it works for any concave outline (e.g. the
// coin's custom SVG logo, whose fine concave fillets fold a true offset over
// itself). It also keeps one vertex per source vertex, so the side walls just
// connect corresponding top/base vertices, and both caps share one ear-clipped
// triangulation. The result is always a watertight, manifold solid.
//
// `inset`/`outset` are interpreted at the outermost point of the face (the
// bounding radius from the centroid): the farthest vertex moves in/out by
// exactly that distance and inner vertices move proportionally less.
export function buildPlatform(
	shape: Shape,
	{ height, inset, outset }: { height: number; inset: number; outset: number }
): BufferGeometry {
	try {
		manifold();
		return buildPlatformViaCrossSection(shape, { height, inset, outset });
	} catch {
		return buildPlatformLegacy(shape, { height, inset, outset });
	}
}

function buildPlatformLegacy(
	shape: Shape,
	{ height, inset, outset }: { height: number; inset: number; outset: number }
): BufferGeometry {
	const face = simplifyLoop(polygonPoints(shape), 0.05);
	const n = face.length;
	if (n < 3) {
		return new BufferGeometry();
	}
	// normalize to CCW (in 2D x,y) so the cap/wall winding below is consistent
	// regardless of the orientation the source shape happened to use.
	if (signedArea(face) < 0) {
		face.reverse();
	}

	const centroid = polygonCentroid(face);
	let radius = 0;
	for (const p of face) {
		radius = Math.max(radius, p.distanceTo(centroid));
	}
	if (radius < 1e-6) {
		return new BufferGeometry();
	}
	// scale factors that move the outermost vertex in by `inset` / out by
	// `outset`. clamp the top so a large inset can't collapse or invert it.
	const topScale = Math.max(0.02, (radius - inset) / radius);
	const baseScale = (radius + outset) / radius;
	const scaleAbout = (p: Vector2, s: number) =>
		new Vector2(centroid.x + (p.x - centroid.x) * s, centroid.y + (p.y - centroid.y) * s);
	const top = face.map((p) => scaleAbout(p, topScale));
	const base = face.map((p) => scaleAbout(p, baseScale));

	const positions: number[] = [];
	const push = (p: Vector2, y: number) => positions.push(p.x, y, p.y);

	// side walls: one quad per edge, split into two triangles. wound so the
	// outward face points away from the interior.
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

	// caps: ear-clip the ring once and reuse the indices for both ends (top and
	// base are the same polygon scaled, so one triangulation is valid for both).
	// ear clipping indexes into the ring vertices without introducing new points,
	// so each cap's boundary is exactly the ring edges and lines up with the
	// side-wall top/bottom edges. the bottom cap keeps the (CCW) winding so its
	// normal points down; the top cap is reversed so its normal points up.
	const capTris = ShapeUtils.triangulateShape(top, []);
	for (const [a, b, c] of capTris) {
		push(base[a], 0);
		push(base[b], 0);
		push(base[c], 0);
		push(top[a], height);
		push(top[c], height);
		push(top[b], height);
	}

	const geo = new BufferGeometry();
	geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
	// compute flat (per-face) normals BEFORE welding: the geometry is non-indexed
	// here, so every triangle owns its three corners and gets its own face normal.
	// merging afterwards only welds corners whose normals also match, so the sharp
	// wall/cap and wall/wall seams stay hard. doing it the other way round welds
	// by position first and then averages normals across those seams, which tilts
	// the perimeter normals down-and-out and shades the drafted base near-black.
	geo.computeVertexNormals();
	const merged = mergeVertices(geo);
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

// Area-weighted centroid of a polygon. Falls back to the vertex average for a
// (near) zero-area loop.
function polygonCentroid(points: Array<Vector2>): Vector2 {
	const n = points.length;
	let area = 0;
	let cx = 0;
	let cy = 0;
	for (let i = 0; i < n; i++) {
		const a = points[i];
		const b = points[(i + 1) % n];
		const cross = a.x * b.y - b.x * a.y;
		area += cross;
		cx += (a.x + b.x) * cross;
		cy += (a.y + b.y) * cross;
	}
	if (Math.abs(area) < 1e-9) {
		const avg = new Vector2();
		for (const p of points) avg.add(p);
		return avg.divideScalar(n || 1);
	}
	return new Vector2(cx / (3 * area), cy / (3 * area));
}

// Get the polygon vertices of a shape, dropping a duplicated closing point and
// any (near) coincident consecutive points. `getPoints(24)` over-samples each
// straight segment 24x, so the dedupe is what keeps a polygon's edges as single
// segments; the simplify pass below thins genuinely curved outlines.
function polygonPoints(shape: Shape): Array<Vector2> {
	const raw = shape.getPoints(24);
	const pts: Array<Vector2> = [];
	for (const p of raw) {
		const last = pts[pts.length - 1];
		if (!last || last.distanceToSquared(p) > 1e-12) {
			pts.push(p.clone());
		}
	}
	if (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-12) {
		pts.pop();
	}
	return pts;
}

// Douglas-Peucker simplification of a closed loop. Curved outlines like the
// coin's custom path arrive heavily over-sampled (thousands of points along the
// arcs); thinning them to a `tol`-mm deviation keeps the pedestal light and,
// more importantly, removes the near-zero-area sliver triangles a dense ring
// would otherwise tessellate into (which a manifold check flags as degenerate).
function simplifyLoop(points: Array<Vector2>, tol: number): Array<Vector2> {
	const n = points.length;
	if (n < 4) {
		return points;
	}
	const simplifyOpen = (pts: Array<Vector2>): Array<Vector2> => {
		if (pts.length < 3) {
			return pts.slice();
		}
		const a = pts[0];
		const b = pts[pts.length - 1];
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy);
		let maxDist = -1;
		let idx = -1;
		for (let i = 1; i < pts.length - 1; i++) {
			const p = pts[i];
			const dist =
				len < 1e-12
					? Math.hypot(p.x - a.x, p.y - a.y)
					: Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
			if (dist > maxDist) {
				maxDist = dist;
				idx = i;
			}
		}
		if (maxDist > tol) {
			const left = simplifyOpen(pts.slice(0, idx + 1));
			const right = simplifyOpen(pts.slice(idx));
			return left.slice(0, -1).concat(right);
		}
		return [a, b];
	};
	// treat the closed loop as an open polyline that starts and ends at the same
	// point, simplify, then drop the duplicated end.
	const open = points.concat([points[0]]);
	const out = simplifyOpen(open);
	out.pop();
	return out.length >= 3 ? out : points;
}
