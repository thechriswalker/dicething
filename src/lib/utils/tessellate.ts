import { BufferAttribute, BufferGeometry, Shape, Vector2 } from 'three';
import libtess from 'libtess';

// A drop-in replacement for THREE.ShapeGeometry that triangulates with libtess.js
// (a port of SGI's GLU sweep-line tessellator) instead of earcut.
//
// earcut handles holes by cutting "bridge" edges from each hole to the outer
// contour and triangulating the resulting single ring. Near collinear/coincident
// features (very common in font glyphs - e.g. a hole edge collinear with the
// outer edge) this produces near-degenerate slivers, folded/overlapping
// triangles and dropped vertices, which leaves the engraving non-manifold.
//
// libtess processes every contour together with a winding rule and no bridging,
// which avoids that failure mode and gives a clean triangulation whose boundary
// edges match the contours we build the engraving walls from.

const GL_TRIANGLES = 4;

let tesselator: any;

function getTesselator(): any {
	if (tesselator) {
		return tesselator;
	}
	const t = new libtess.GluTesselator();
	// VERTEX_DATA: receives the data we attached to each vertex; collect 2D coords.
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, (data: number[], out: number[]) => {
		out.push(data[0], data[1]);
	});
	// BEGIN: with the edge-flag callback set the only primitive is GL_TRIANGLES.
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, (type: number) => {
		if (type !== GL_TRIANGLES) {
			throw new Error('libtess: expected GL_TRIANGLES, got ' + type);
		}
	});
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, (errno: number) => {
		throw new Error('libtess error: ' + errno);
	});
	// COMBINE: called when the tessellator needs a new vertex (e.g. where two
	// contours touch). Return interpolated coordinates as the new vertex data.
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, (coords: number[]) => {
		return [coords[0], coords[1], coords[2]];
	});
	// Setting an edge-flag callback forces output as plain triangles rather than
	// fans/strips, even though we don't use the flag itself.
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_EDGE_FLAG, () => {});
	tesselator = t;
	return t;
}

// Triangulate a single contour-with-holes into a flat array of 2D triangle
// vertices [x0,y0, x1,y1, x2,y2, ...] (every 6 numbers is one triangle).
function triangulateContours(contours: Array<Array<Vector2>>): Array<number> {
	const t = getTesselator();
	const out: Array<number> = [];
	t.gluTessNormal(0, 0, 1);
	// even-odd winding: robust to contour orientation, fills outer minus holes.
	t.gluTessProperty(
		libtess.gluEnum.GLU_TESS_WINDING_RULE,
		libtess.windingRule.GLU_TESS_WINDING_ODD
	);
	t.gluTessBeginPolygon(out);
	for (const contour of contours) {
		if (contour.length < 3) {
			continue;
		}
		t.gluTessBeginContour();
		for (const p of contour) {
			const coords = [p.x, p.y, 0];
			t.gluTessVertex(coords, [p.x, p.y]);
		}
		t.gluTessEndContour();
	}
	t.gluTessEndPolygon();
	return out;
}

const GL_LINE_LOOP = 2;

let boundaryTess: any;
let blLoops: Array<Array<Vector2>>;
let blCurrent: Array<Vector2>;

// A second tessellator configured for boundary extraction (GL_LINE_LOOP output)
// rather than triangles.
function getBoundaryTesselator(): any {
	if (boundaryTess) {
		return boundaryTess;
	}
	const t = new libtess.GluTesselator();
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_BEGIN, (type: number) => {
		if (type !== GL_LINE_LOOP) {
			throw new Error('libtess: expected GL_LINE_LOOP, got ' + type);
		}
		blCurrent = [];
	});
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_VERTEX_DATA, (data: number[]) => {
		blCurrent.push(new Vector2(data[0], data[1]));
	});
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_END, () => {
		if (blCurrent.length >= 3) {
			blLoops.push(blCurrent);
		}
	});
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_ERROR, (errno: number) => {
		throw new Error('libtess error: ' + errno);
	});
	t.gluTessCallback(libtess.gluEnum.GLU_TESS_COMBINE, (coords: number[]) => {
		return [coords[0], coords[1], coords[2]];
	});
	boundaryTess = t;
	return t;
}

// Compute the boundary contours of the union of a set of input contours, using
// libtess in boundary-only nonzero mode. This robustly merges a self-overlapping
// soup (e.g. the triangles of a stroke mesh) into clean nested loops, where a
// naive boundary-edge walk would fragment at self-touch points. Returns loops as
// emitted (outer/holes mixed); nest them by containment downstream.
export function unionBoundaryLoops(contours: Array<Array<Vector2>>): Array<Array<Vector2>> {
	const t = getBoundaryTesselator();
	blLoops = [];
	t.gluTessNormal(0, 0, 1);
	t.gluTessProperty(
		libtess.gluEnum.GLU_TESS_WINDING_RULE,
		libtess.windingRule.GLU_TESS_WINDING_NONZERO
	);
	t.gluTessProperty(libtess.gluEnum.GLU_TESS_BOUNDARY_ONLY, true);
	t.gluTessBeginPolygon([]);
	for (const contour of contours) {
		if (contour.length < 3) {
			continue;
		}
		t.gluTessBeginContour();
		for (const p of contour) {
			t.gluTessVertex([p.x, p.y, 0], [p.x, p.y]);
		}
		t.gluTessEndContour();
	}
	t.gluTessEndPolygon();
	return blLoops;
}

// Drop-in replacement for `new ShapeGeometry(shapes, divisions)`. Returns a
// non-indexed BufferGeometry in the z=0 plane with computed normals.
export function shapeGeometry(shapes: Shape | Array<Shape>, divisions: number): BufferGeometry {
	const list = Array.isArray(shapes) ? shapes : [shapes];
	const positions: Array<number> = [];
	for (const s of list) {
		const contour = s.getPoints(divisions);
		const holes = s.getPointsHoles(divisions);
		const flat = triangulateContours([contour, ...holes]);
		for (let i = 0; i < flat.length; i += 2) {
			positions.push(flat[i], flat[i + 1], 0);
		}
	}
	const geo = new BufferGeometry();
	geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
	geo.computeVertexNormals();
	return geo;
}
