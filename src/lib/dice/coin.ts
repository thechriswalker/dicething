// A D2 "coin": a flat disc with a number on each side.
//
// A disc is really an n-gon prism. To read as "round" it needs a lot of sides,
// which would normally flood the face list with hundreds of un-editable rim
// "faces". Instead the rim segments are built as `hidden` faces: they are part
// of the geometry (and the export) but are never shown in the UI or selectable.
// That leaves just the two real faces (heads = 1, tails = 2) for the user to
// edit, while a high segment count still renders a smooth disc.

import type {
	DiceParameter,
	DieFaceModel,
	DieModel,
	StringParameter
} from '$lib/interfaces/dice';
import { Transform } from '$lib/utils/3d';
import { parseCoinPath, validateCoinPath } from '$lib/utils/coin_path';
import { stackedExplode } from '$lib/utils/explode';
import { Legend, pickForNumber } from '$lib/utils/legends';
import { orientCoplanarVertices } from '$lib/utils/shapes';
import { Shape, Vector2, Vector3 } from 'three';

const defaultDiameter = 24;
const defaultThickness = 3;
const defaultSegments = 7;
// shape mode toggle values.
const MODE_POLYGON = 0;
const MODE_CUSTOM = 1;
// a sensible default slope so a user only needs to raise the "amount" to get a
// reasonable bevel.
const defaultBevelAngle = 40;
const defaultBevelAmount = 50;

const xAxis = new Vector3(1, 0, 0);
const yAxis = new Vector3(0, 1, 0);

const coinParameters: Array<DiceParameter> = [
	{
		// pick between a regular polygon (with a rim-segment count) and a custom
		// user-supplied SVG path for the two faces.
		id: 'coin_shape_mode',
		defaultValue: MODE_POLYGON,
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

const coinStringParameters: Array<StringParameter> = [
	{
		// a raw SVG path `d` string used for the two faces when in custom mode.
		id: 'coin_path',
		defaultValue: '',
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

export const CoinD2: DieModel = {
	id: 'coin_d2',
	name: 'D2 Coin',
	parameters: coinParameters,
	stringParameters: coinStringParameters,
	build(params, stringParams = {}) {
		const diameter = params.coin_diameter ?? defaultDiameter;
		const thickness = params.coin_thickness ?? defaultThickness;
		const segments = Math.max(3, Math.round(params.coin_segments ?? defaultSegments));
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
		const mode = Math.round(params.coin_shape_mode ?? MODE_POLYGON);
		const custom = mode === MODE_CUSTOM ? parseCoinPath(stringParams.coin_path ?? '') : null;

		let innerRing: Array<Vector2>;
		let outerRing: Array<Vector2>;
		// a concave outline needs a convex region for legend fitting/containment
		// (scaled to match the inner face ring). a convex outline fits against
		// itself. the back face is mirrored (see backFaceShape) so its fit region
		// must be mirrored to match.
		let frontFit: Shape | undefined;
		let backFit: Shape | undefined;
		if (custom) {
			innerRing = custom.outline.map((p) => new Vector2(p.x * 2 * rInner, p.y * 2 * rInner));
			outerRing = custom.outline.map((p) => new Vector2(p.x * 2 * R, p.y * 2 * R));
			if (!custom.convex) {
				frontFit = new Shape(
					custom.fitOutline.map((p) => new Vector2(p.x * 2 * rInner, p.y * 2 * rInner))
				);
				backFit = new Shape(
					custom.fitOutline.map((p) => new Vector2(-p.x * 2 * rInner, p.y * 2 * rInner)).reverse()
				);
			}
		} else {
			// the flat faces sit on the (possibly inset) inner ring; the bevel/rim use
			// the full-radius outer ring. built from shared rings so the walls always
			// meet the face edges exactly.
			innerRing = ngonPoints(rInner, segments);
			outerRing = ngonPoints(R, segments);
		}
		const n = innerRing.length;
		const faceShape = new Shape(innerRing.map((p) => p.clone()));
		// the back face is flipped 180° about the y-axis, so its outline must be
		// mirrored in x (and reversed to keep the clockwise winding, so it still
		// faces outward) for the flipped ring to land back on the inner ring. for a
		// regular polygon this is identical to `faceShape` (it's y-symmetric); for a
		// custom outline it keeps the back face aligned with the rim quads. the
		// legend is engraved independently of the outline, so it still reads upright.
		const backFaceShape = new Shape(
			innerRing.map((p) => new Vector2(-p.x, p.y)).reverse()
		);

		const faces: Array<DieFaceModel> = [
			{
				isNumberFace: true,
				shape: backFaceShape,
				fitShape: backFit,
				defaultLegend: Legend.BLANK,
				transform: new Transform().translateBy(0, 0, ht).rotateByAxisAngle(yAxis, Math.PI)
			},
			{
				isNumberFace: true,
				shape: faceShape,
				fitShape: frontFit,
				defaultLegend: Legend.MAKER_LOGO,
				transform: new Transform().translateBy(0, 0, ht)
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
