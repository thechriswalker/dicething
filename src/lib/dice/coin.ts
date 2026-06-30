// A D2 "coin": a flat disc with a number on each side.
//
// A disc is really an n-gon prism. To read as "round" it needs a lot of sides,
// which would normally flood the face list with hundreds of un-editable rim
// "faces". Instead the rim segments are built as `hidden` faces: they are part
// of the geometry (and the export) but are never shown in the UI or selectable.
// That leaves just the two real faces (heads = 1, tails = 2) for the user to
// edit, while a high segment count still renders a smooth disc.

import type { DiceParameter, DieFaceModel, DieModel, StringParameter } from '$lib/interfaces/dice';
import { Transform } from '$lib/utils/3d';
import { parseCoinPath, validateCoinPath } from '$lib/utils/coin_path';
import { stackedExplode } from '$lib/utils/explode';
import { Legend } from '$lib/utils/legends';
import { orientCoplanarVertices } from '$lib/utils/shapes';
import { shapeGeometry } from '$lib/utils/tessellate';
import { BufferGeometry, Float32BufferAttribute, Shape, Vector2, Vector3 } from 'three';

const defaultDiameter = 24;
const defaultThickness = 3;
const defaultSegments = 9;
// shape mode toggle values.
const MODE_POLYGON = 0;
const MODE_CUSTOM = 1;
const defaultMode = MODE_POLYGON;
// a sensible default slope so a user only needs to raise the "amount" to get a
// reasonable bevel.
const defaultBevelAngle = 40;
const defaultBevelAmount = 50;

const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);

// In a box, rest the coin tilted rather than flat so its face is on show; the
// printed insert cradles it at this angle. The disc is built in the XY plane
// (axis = +Z), so this is a tilt off the flat lie about the X axis.
const boxTiltAngle = (15 * Math.PI) / 180;

// Round off the wedge's top edges (back + sides) by this radius (mm) so it isn't
// sharp where the slope meets the vertical walls.
const wedgeRound = 1.4;
const wedgeRoundSegments = 12;

const coinParameters: Array<DiceParameter> = [
	{
		// pick between a regular polygon (with a rim-segment count) and a custom
		// user-supplied SVG path for the two faces.
		id: 'coin_shape_mode',
		defaultValue: defaultMode,
		min: 0,
		max: 1,
		step: 1,
		display: {
			kind: 'toggle',
			options: [
				{ value: MODE_POLYGON, label: 'coin_shape_polygon' },
				{ value: MODE_CUSTOM, label: 'coin_shape_custom' }
			]
		}
	},
	{
		id: 'coin_diameter',
		defaultValue: defaultDiameter,
		min: 8,
		max: 60,
		step: 0.5
	},
	{
		id: 'coin_thickness',
		defaultValue: defaultThickness,
		min: 1.5,
		max: 20,
		step: 0.1
	},
	{
		id: 'coin_segments',
		// the number of rim segments. higher = rounder, but more (hidden) faces.
		defaultValue: defaultSegments,
		min: 3,
		max: 96,
		step: 1,
		// only relevant for the polygon mode.
		visibleWhen: { param: 'coin_shape_mode', equals: MODE_POLYGON }
	},
	{
		id: 'coin_bevel_angle',
		// slope of the bevelled edge, measured from the vertical rim (0° = a flat
		// vertical edge with no chamfer, 45° = the deepest chamfer).
		defaultValue: defaultBevelAngle,
		min: 0,
		max: 45,
		step: 1
	},
	{
		id: 'coin_bevel_amount',
		// percentage of the half-thickness consumed by the bevel. 0% leaves a flat
		// edge; 100% removes the straight rim entirely so the two bevels meet in a
		// point (a lens/discus edge).
		defaultValue: defaultBevelAmount,
		min: 0,
		max: 100,
		step: 1
	}
];

// this is the concave path of the outline of the dicething logo
const defaultPath = `M 206.779 143.103 Q 207.693 140.246 210.691 140.140 L 227.300 139.554 Q 230.298 139.449 230.298 136.449 L 230.298 103.551 Q 230.298 100.551 227.300 100.446 L 210.691 99.860 Q 207.693 99.754 206.779 96.897 L 204.064 88.416 Q 203.149 85.558 201.776 82.891 L 197.698 74.974 Q 196.324 72.307 198.370 70.113 L 209.700 57.954 Q 211.745 55.759 209.624 53.638 L 186.362 30.376 Q 184.241 28.255 182.046 30.300 L 169.887 41.630 Q 167.693 43.676 165.026 42.302 L 157.109 38.224 Q 154.442 36.851 151.584 35.936 L 143.103 33.221 Q 140.246 32.307 140.140 29.309 L 139.554 12.700 Q 139.449 9.702 136.449 9.702 L 103.551 9.702 Q 100.551 9.702 100.446 12.700 L 99.860 29.309 Q 99.754 32.307 96.897 33.221 L 88.416 35.936 Q 85.558 36.851 82.891 38.224 L 74.974 42.302 Q 72.307 43.676 70.113 41.630 L 57.954 30.300 Q 55.759 28.255 53.638 30.376 L 30.376 53.638 Q 28.255 55.759 30.300 57.954 L 41.630 70.113 Q 43.676 72.307 42.302 74.974 L 38.224 82.891 Q 36.851 85.558 35.936 88.416 L 33.221 96.897 Q 32.307 99.754 29.309 99.860 L 12.700 100.446 Q 9.702 100.551 9.702 103.551 L 9.702 136.449 Q 9.702 139.449 12.700 139.554 L 29.309 140.140 Q 32.307 140.246 33.221 143.103 L 35.936 151.584 Q 36.851 154.442 38.224 157.109 L 42.302 165.026 Q 43.676 167.693 41.630 169.887 L 30.300 182.046 Q 28.255 184.241 30.376 186.362 L 53.638 209.624 Q 55.759 211.745 57.954 209.700 L 70.113 198.370 Q 72.307 196.324 74.974 197.698 L 82.891 201.776 Q 85.558 203.149 88.416 204.064 L 96.897 206.779 Q 99.754 207.693 99.860 210.691 L 100.446 227.300 Q 100.551 230.298 103.551 230.298 L 136.449 230.298 Q 139.449 230.298 139.554 227.300 L 140.140 210.691 Q 140.246 207.693 143.103 206.779 L 151.584 204.064 Q 154.442 203.149 157.109 201.776 L 165.026 197.698 Q 167.693 196.324 169.887 198.370 L 182.046 209.700 Q 184.241 211.745 186.362 209.624 L 209.624 186.362 Q 211.745 184.241 209.700 182.046 L 198.370 169.887 Q 196.324 167.693 197.698 165.026 L 201.776 157.109 Q 203.149 154.442 204.064 151.584 L 206.779 143.103 Z`;

const coinStringParameters: Array<StringParameter> = [
	{
		// a raw SVG path `d` string used for the two faces when in custom mode.
		id: 'coin_path',
		defaultValue: defaultPath,
		visibleWhen: { param: 'coin_shape_mode', equals: MODE_CUSTOM },
		validate: validateCoinPath
	}
];

// the vertices of a regular n-gon centered on the origin in the XY plane, wound
// clockwise to match the other dice's front-face convention (so engraved
// legends read the right way round). A vertex sits at the top, so the polygon
// is symmetric about the y-axis (this matters for flipping the back face).
function ngonPoints(radius: number, segments: number): Array<Vector2> {
	const pts: Array<Vector2> = [];
	const start = Math.PI / 2; // start at the top
	for (let k = 0; k < segments; k++) {
		const a = start - (k * 2 * Math.PI) / segments; // clockwise
		pts.push(new Vector2(radius * Math.cos(a), radius * Math.sin(a)));
	}
	return pts;
}

// build a hidden (non-UI) facet from its 3D corners, orienting its engraving
// front to point away from the axis so it shades correctly from outside.
function hiddenFacet(corners: Array<Vector3>): DieFaceModel {
	const centroid = corners
		.reduce((acc, v) => acc.add(v), new Vector3())
		.multiplyScalar(1 / corners.length);
	let info = orientCoplanarVertices(corners);
	if (info.normal.dot(centroid) < 0) {
		info = orientCoplanarVertices([...corners].reverse());
	}
	return {
		isNumberFace: false,
		hidden: true,
		shape: info.shape,
		defaultLegend: Legend.BLANK,
		transform: new Transform().rotate(info.quat).translate(info.offset)
	};
}

// The radius of the coin's flat face ring (the full radius minus the bevel's
// radial cut). Mirrors the maths in build() so the box support can rebuild the
// real face shape without depending on a built solid.
function coinInnerRadius(params: Record<string, number>): number {
	const R = (params.coin_diameter ?? defaultDiameter) / 2;
	const ht = (params.coin_thickness ?? defaultThickness) / 2;
	const bevelAngle = ((params.coin_bevel_angle ?? defaultBevelAngle) * Math.PI) / 180;
	const bevelAmount = Math.min(
		1,
		Math.max(0, (params.coin_bevel_amount ?? defaultBevelAmount) / 100)
	);
	const inset = Math.min(R * 0.9, bevelAmount * ht * Math.tan(bevelAngle));
	return R - inset;
}

// Resize the coin for a blank / box cavity: a positive offset shrinks it (each
// surface moves in by `offset`, so the diameter and thickness each lose 2*offset),
// a negative offset grows it. The box cavity uses offset = -tolerance so the real
// coin drops in; sharing this (rather than the generic uniform mesh scale) keeps
// the cavity a true offset coin, which the box support relies on to land its top
// exactly on the cavity's underside.
function coinBlankParameters(
	params: Record<string, number>,
	offset: number
): Record<string, number> {
	const diameter = params.coin_diameter ?? defaultDiameter;
	const thickness = params.coin_thickness ?? defaultThickness;
	return {
		...params,
		coin_diameter: Math.max(1, diameter - 2 * offset),
		coin_thickness: Math.max(0.5, thickness - 2 * offset)
	};
}

// The coin's face outline at a given radius: a regular n-gon, or the resolved
// custom-path outline scaled so its bounding box spans 2*radius (matching the way
// build() scales it). Shared by build() and the box support so the support wedge
// is shaped by the real face outline. May be concave (a custom path).
function coinShapeOutline(
	params: Record<string, number>,
	stringParams: Record<string, string>,
	radius: number
): Array<Vector2> {
	const mode = Math.round(params.coin_shape_mode ?? defaultMode);
	if (mode === MODE_CUSTOM) {
		const custom = parseCoinPath(stringParams.coin_path ?? defaultPath);
		if (custom) {
			return custom.outline.map((p) => new Vector2(p.x * 2 * radius, p.y * 2 * radius));
		}
	}
	const segments = Math.max(3, Math.round(params.coin_segments ?? defaultSegments));
	return ngonPoints(radius, segments);
}

// Sutherland-Hodgman clip of a (possibly concave) polygon against one half-plane.
// `inside` decides which side to keep; `crossing` gives the point where edge a->b
// meets the clip line. Returns the clipped loop (may be empty).
function clipHalfPlane(
	poly: Array<Vector2>,
	inside: (p: Vector2) => boolean,
	crossing: (a: Vector2, b: Vector2) => Vector2
): Array<Vector2> {
	const out: Array<Vector2> = [];
	const n = poly.length;
	for (let i = 0; i < n; i++) {
		const a = poly[(i - 1 + n) % n];
		const b = poly[i];
		const ina = inside(a);
		const inb = inside(b);
		if (inb) {
			if (!ina) out.push(crossing(a, b));
			out.push(b);
		} else if (ina) {
			out.push(crossing(a, b));
		}
	}
	return out;
}

const yCrossing = (a: Vector2, b: Vector2, y: number) => {
	const t = (y - a.y) / (b.y - a.y);
	return new Vector2(a.x + t * (b.x - a.x), y);
};

type V3 = [number, number, number];

// build a solid "wedge" prism from a 2D loop (in the XY plane), which may be
// CONCAVE (e.g. a custom coin outline): a flat floor at z = 0 and a planar slanted
// top at z = topZ(y), joined by vertical walls. The loop is normalised to CCW so
// the hand-built walls wind outward, and the caps are tessellated (libtess, via
// shapeGeometry) so a concave outline triangulates cleanly. Manifold reads the
// winding directly, so the soup is emitted outward.
//
// `chamfer` rounds the top perimeter (where the slanted top meets the walls): the
// profile follows a convex quarter-arc of radius `chamfer`, faceted by
// `roundSegments`, that insets the top inward and drops the wall top down. The
// inset is done by scaling the loop toward its centroid (never self-intersects,
// unlike a per-edge offset on a concave loop), so the rounding is robust on the
// gear-like custom outlines. The bottom edge is left sharp (it merges into base).
function wedgeFromLoop(
	loop: Array<Vector2>,
	topZ: (y: number) => number,
	chamfer: number,
	roundSegments: number
): BufferGeometry {
	let area = 0;
	for (let i = 0; i < loop.length; i++) {
		const a = loop[i];
		const b = loop[(i + 1) % loop.length];
		area += a.x * b.y - b.x * a.y;
	}
	const poly = area < 0 ? [...loop].reverse() : loop;
	const n = poly.length;

	const cx = poly.reduce((s, p) => s + p.x, 0) / n;
	const cy = poly.reduce((s, p) => s + p.y, 0) / n;
	const centre = new Vector2(cx, cy);
	const rref = Math.max(
		1e-3,
		poly.reduce((m, p) => Math.max(m, p.distanceTo(centre)), 0)
	);

	const tris: Array<number> = [];
	const pushTri = (a: V3, b: V3, c: V3) =>
		tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
	// outward band of quads from a lower ring to a higher one (both CCW).
	const band = (lo: Array<V3>, hi: Array<V3>) => {
		for (let i = 0; i < n; i++) {
			const j = (i + 1) % n;
			pushTri(lo[i], lo[j], hi[j]);
			pushTri(lo[i], hi[j], hi[i]);
		}
	};

	const rounding = chamfer > 1e-6 ? Math.max(1, Math.round(roundSegments)) : 0;
	// the loop scaled toward the centroid by `scale` (0..1), used both for the
	// rounding rings and for the inset top cap. scaling can't self-intersect.
	const scaledLoop = (scale: number): Array<Vector2> =>
		poly.map((p) => new Vector2(cx + (p.x - cx) * scale, cy + (p.y - cy) * scale));
	// profile ring at arc parameter t in [0,1] (0 = wall top, 1 = inset top cap).
	const ringAt = (t: number): Array<V3> => {
		const phi = (Math.PI / 2) * t;
		const inset = chamfer * (1 - Math.cos(phi)); // 0 -> chamfer
		const drop = chamfer * (1 - Math.sin(phi)); // chamfer -> 0
		const scale = Math.max(0, 1 - inset / rref);
		return scaledLoop(scale).map((p) => [p.x, p.y, Math.max(0.02, topZ(p.y) - drop)] as V3);
	};

	const floor: Array<V3> = poly.map((p) => [p.x, p.y, 0]);
	let topScale = 1;
	if (rounding === 0) {
		const top: Array<V3> = poly.map((p) => [p.x, p.y, topZ(p.y)]);
		band(floor, top);
	} else {
		let prev = floor;
		for (let s = 0; s <= rounding; s++) {
			const ring = ringAt(s / rounding);
			band(prev, ring);
			prev = ring;
		}
		topScale = Math.max(0, 1 - chamfer / rref);
	}

	// caps: tessellate the floor (original loop, facing -z) and the top (inset loop
	// lifted onto the slant plane, facing +z). divisions = 1 keeps line segments at
	// their endpoints, so the cap boundary vertices coincide with the ring vertices.
	const cap = (loop2D: Array<Vector2>, zAt: (y: number) => number, faceUp: boolean) => {
		const geo = shapeGeometry(new Shape(loop2D), 1);
		const p = geo.getAttribute('position');
		for (let t = 0; t < p.count; t += 3) {
			const v: Array<V3> = [];
			for (let k = 0; k < 3; k++) {
				const x = p.getX(t + k);
				const y = p.getY(t + k);
				v.push([x, y, zAt(y)]);
			}
			if (faceUp) pushTri(v[0], v[1], v[2]);
			else pushTri(v[0], v[2], v[1]);
		}
		geo.dispose();
	};
	cap(poly, () => 0, false);
	cap(scaledLoop(topScale), (y) => topZ(y), true);

	const out = new BufferGeometry();
	out.setAttribute('position', new Float32BufferAttribute(tris, 3));
	out.computeVertexNormals();
	return out;
}

export const CoinD2: DieModel = {
	id: 'd2_coin',
	name: 'D2 Coin',
	parameters: coinParameters,
	stringParameters: coinStringParameters,
	blankParameters: coinBlankParameters,
	boxTransform: new Transform().rotateByAxisAngle(xAxis, boxTiltAngle),
	// Tilted in the box, the coin balances near its centre of gravity and its high
	// (+y) half rises out of the base, above the seam. Prop it with a solid whose
	// TOP face IS the coin's underside (the slope continues the plane of the indent)
	// - i.e. the cradle made solid - and whose footprint is the coin's FULL real FACE
	// SHAPE (the flat-face outline, polygon or custom path), projected: the underside
	// outline (at z = -thickness/2) is tilted about X and dropped onto the box XY
	// plane. Spanning the whole face (not a pulled-back band) keeps the wedge's edge
	// on the same outline as the indent right up to the high tips, so the floor is one
	// continuous face shape with no chord/step across it. Only the low side is clipped
	// (where the slope would dive below the floor). The walls drop straight to the
	// floor, so it only ever narrows going up => draft-free / printable. The fin rises
	// above the seam, into the lid's coin cavity; the builder grows that lid cavity
	// extra (double tolerance) so the fin fits without clashing. Built from the SAME
	// grown ("blank") params the box cavity uses, so the wedge's top lands on the
	// cavity's underside plane and its footprint on the cavity's face outline - the
	// two surfaces coincide (seamless indent).
	boxSupport(params, stringParams, { seam, cavityTolerance }) {
		const c = Math.cos(boxTiltAngle);
		const s = Math.sin(boxTiltAngle);
		const tan = Math.tan(boxTiltAngle);
		const grown = coinBlankParameters(params, -cavityTolerance);
		const th = grown.coin_thickness;
		const radius = coinInnerRadius(grown);
		if (radius <= 1) {
			return undefined;
		}
		// the coin underside plane in box Z: z = base0 + y*tan (rises toward +y).
		const base0 = seam - th / (2 * c);
		const topZ = (y: number) => base0 + y * tan;
		// the face outline, projected from the underside (local z = -th/2) onto box
		// XY: tilt about X drops z=-th/2 to add (th/2)*sin to y and foreshortens y by
		// cos; x is unchanged. topZ then lifts each point back onto the slant plane.
		const ht = th / 2;
		const footprint = coinShapeOutline(grown, stringParams, radius).map(
			(p) => new Vector2(p.x, p.y * c + ht * s)
		);
		let minY = Infinity;
		for (const p of footprint) {
			minY = Math.min(minY, p.y);
		}
		// clip only the low side, where the underside plane would dip below the floor.
		const yLo = Math.max(minY, (0.05 - base0) / tan);
		const clipped =
			yLo > minY + 1e-6
				? clipHalfPlane(
						footprint,
						(p) => p.y >= yLo - 1e-9,
						(a, b) => yCrossing(a, b, yLo)
					)
				: footprint;
		if (clipped.length < 3) {
			return undefined;
		}
		return wedgeFromLoop(clipped, topZ, wedgeRound, wedgeRoundSegments);
	},
	build(params, stringParams = {}) {
		const diameter = params.coin_diameter ?? defaultDiameter;
		const thickness = params.coin_thickness ?? defaultThickness;
		const bevelAngle = ((params.coin_bevel_angle ?? defaultBevelAngle) * Math.PI) / 180;
		const bevelAmount = Math.min(
			1,
			Math.max(0, (params.coin_bevel_amount ?? defaultBevelAmount) / 100)
		);
		const R = diameter / 2;
		const ht = thickness / 2;

		// the bevel eats into the half-thickness (vertically) and, depending on the
		// angle, into the radius. amount = 100% removes the straight rim entirely
		// (the bevels meet at the equator => a point); angle = 0 keeps a vertical
		// edge (no chamfer). clamp the radial cut so a usable flat face remains.
		const bevelHeight = bevelAmount * ht;
		const inset = Math.min(R * 0.9, bevelHeight * Math.tan(bevelAngle));
		const rInner = R - inset;
		const rimHalf = ht - bevelHeight;
		const hasBevel = inset > 1e-6 && bevelHeight > 1e-6;
		const hasRim = rimHalf > 1e-6;

		// resolve the outline. a valid custom path replaces the regular polygon;
		// an empty/invalid path falls back to the polygon so the view stays stable.
		// the unit outline (max bounding dimension = 1) is scaled by 2*radius so it
		// spans the same bounding box the polygon's circumradius would.
		const mode = Math.round(params.coin_shape_mode ?? defaultMode);
		const custom =
			mode === MODE_CUSTOM ? parseCoinPath(stringParams.coin_path ?? defaultPath) : null;

		// whether the face outline is convex. a regular polygon always is; a custom
		// outline may be concave, which switches the legend containment maths to the
		// general (concave-safe) path so legends can use the whole outline.
		const convex = custom ? custom.convex : true;
		// the flat faces sit on the (possibly inset) inner ring; the bevel/rim use the
		// full-radius outer ring. built from the shared outline helper so the walls
		// always meet the face edges exactly (and the box support can rebuild it).
		const innerRing = coinShapeOutline(params, stringParams, rInner);
		const outerRing = coinShapeOutline(params, stringParams, R);
		const n = innerRing.length;
		const faceShape = new Shape(innerRing.map((p) => p.clone()));
		// the back face is flipped 180° about the y-axis, so its outline must be
		// mirrored in x (and reversed to keep the clockwise winding, so it still
		// faces outward) for the flipped ring to land back on the inner ring. for a
		// regular polygon this is identical to `faceShape` (it's y-symmetric); for a
		// custom outline it keeps the back face aligned with the rim quads. the
		// legend is engraved independently of the outline, so it still reads upright.
		const backFaceShape = new Shape(innerRing.map((p) => new Vector2(-p.x, p.y)).reverse());

		const faces: Array<DieFaceModel> = [
			{
				isNumberFace: true,
				shape: faceShape,
				convex,
				defaultLegend: Legend.MAKER_LOGO,
				transform: new Transform().translateBy(0, 0, ht)
			},
			{
				isNumberFace: false,
				shape: backFaceShape,
				convex,
				defaultLegend: Legend.BLANK,
				transform: new Transform().translateBy(0, 0, ht).rotateByAxisAngle(yAxis, Math.PI)
			}
		];

		// the edge, built per polygon segment as hidden facets so the walls meet
		// the face edges exactly: an optional top + bottom bevel (chamfer) and an
		// optional straight rim between them.
		for (let k = 0; k < n; k++) {
			const ai = innerRing[k];
			const bi = innerRing[(k + 1) % n];
			const ao = outerRing[k];
			const bo = outerRing[(k + 1) % n];

			if (hasBevel) {
				// top bevel: inner ring at +ht out/down to outer ring at +rimHalf.
				faces.push(
					hiddenFacet([
						new Vector3(ai.x, ai.y, ht),
						new Vector3(bi.x, bi.y, ht),
						new Vector3(bo.x, bo.y, rimHalf),
						new Vector3(ao.x, ao.y, rimHalf)
					])
				);
				// bottom bevel: mirror of the top.
				faces.push(
					hiddenFacet([
						new Vector3(ai.x, ai.y, -ht),
						new Vector3(bi.x, bi.y, -ht),
						new Vector3(bo.x, bo.y, -rimHalf),
						new Vector3(ao.x, ao.y, -rimHalf)
					])
				);
			}

			if (hasRim) {
				// straight rim wall between the two bevels (full height when no bevel).
				faces.push(
					hiddenFacet([
						new Vector3(ao.x, ao.y, rimHalf),
						new Vector3(bo.x, bo.y, rimHalf),
						new Vector3(bo.x, bo.y, -rimHalf),
						new Vector3(ao.x, ao.y, -rimHalf)
					])
				);
			}
		}

		// flat layout for the explode view: the two faces in a row with the rim
		// segments tucked underneath (they're hidden in the UI but still drawn).
		stackedExplode(faces, { numberColumns: 2 });

		// print lying flat on a face: rotate the disc so its axis is vertical,
		// then raise it to rest on the build plate.
		const printingTransform = new Transform()
			.rotateByAxisAngle(xAxis, Math.PI / 2)
			.translateBy(0, ht, 0);

		return {
			faces,
			faceToFaceDistance: thickness,
			printingTransform
		};
	}
};
