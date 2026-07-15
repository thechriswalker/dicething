// Structural checks for an exported (print-ready) mesh: is it a closed,
// manifold solid with no degenerate or duplicate triangles? This is the same
// class of checks an external STL repair tool runs ("watertight", "manifold",
// "no degenerate triangles"), so we can flag a die as un-printable before the
// user ever leaves the app.
//
// Two entry points:
//   - `checkMesh`: flat, NON-INDEXED position buffer (9 numbers per triangle),
//     exactly what an STL stores / `Builder.export()` used to emit. Welds
//     coincident corners by a tolerance grid so hard-edge seams left unwelded
//     by normals still count as the same point.
//   - `checkIndexedMesh`: already-welded indexed mesh (Manifold MeshGL / 3MF).
//     Uses vertex indices directly — no geometric weld. Prefer this for
//     Manifold solids: Manifold may keep distinct verts a few microns apart
//     (e.g. across face-ID property seams) that a 1e-4 mm weld collapses into
//     false "degenerate" triangles and cascading false open edges.
//
// There is no three.js dependency here on purpose so the whole thing can run
// in a tiny web worker (see mesh-check.worker.ts) with nothing else loaded.

export type MeshCheckReport = {
	// total triangles in the buffer (including any degenerate ones).
	triangleCount: number;
	// collapsed triangles: two or more corners weld to the same vertex, so the
	// triangle has a zero-length edge and contributes no real surface. A thin but
	// non-collapsed sliver (three distinct vertices, near-zero area) is NOT counted
	// here -- its edges are real and balance with its neighbours.
	degenerateTriangleCount: number;
	// triangles that repeat an earlier triangle (same three corners).
	duplicateTriangleCount: number;
	// edges used by exactly one (non-degenerate) triangle => holes / open mesh.
	boundaryEdgeCount: number;
	// edges shared by three or more triangles => non-manifold junctions.
	nonManifoldEdgeCount: number;
	// no edge is shared by more than two triangles.
	isManifold: boolean;
	// no open boundary edges: the surface is closed.
	isWatertight: boolean;
	// closed, manifold, and free of degenerate/duplicate triangles: safe to print.
	isPrintable: boolean;
	// optional flat positions (9 per triangle) of every problem triangle, for
	// visualisation. only populated when `collectBad` is set.
	badPositions?: Float32Array;
	// optional flat positions (6 per edge: ax,ay,az,bx,by,bz) of every problem
	// edge - boundary (open) and non-manifold edges. These are the only signal
	// when a mesh is unsound purely at its edges (no degenerate/duplicate tris),
	// so the visualiser has somewhere to point. Only populated when `collectBad`
	// is set. Endpoints are the welded representative coordinates.
	badEdgePositions?: Float32Array;
};

export type MeshCheckOptions = {
	// vertex-weld tolerance in mm. coincident corners closer than this are
	// treated as the same vertex. mirrors three's mergeVertices default.
	tolerance?: number;
	// also gather the positions of problem triangles into `badPositions`.
	collectBad?: boolean;
};

const DEFAULT_TOLERANCE = 1e-4;

type CornerId = (x: number, y: number, z: number) => number;

function finishReport(
	triangleCount: number,
	degenerateTriangleCount: number,
	duplicateTriangleCount: number,
	edgeUse: Map<string, number>,
	repX: ArrayLike<number>,
	repY: ArrayLike<number>,
	repZ: ArrayLike<number>,
	bad: Array<number> | null,
	badEdgesWanted: boolean
): MeshCheckReport {
	let boundaryEdgeCount = 0;
	let nonManifoldEdgeCount = 0;
	const badEdges: Array<number> = badEdgesWanted ? [] : (null as never);
	for (const [id, count] of edgeUse) {
		const isBad = count === 1 || count > 2;
		if (count === 1) {
			boundaryEdgeCount++;
		} else if (count > 2) {
			nonManifoldEdgeCount++;
		}
		if (isBad && badEdges) {
			const sep = id.indexOf('|');
			const a = Number(id.slice(0, sep));
			const b = Number(id.slice(sep + 1));
			badEdges.push(repX[a], repY[a], repZ[a], repX[b], repY[b], repZ[b]);
		}
	}

	const isManifold = nonManifoldEdgeCount === 0;
	const isWatertight = boundaryEdgeCount === 0;
	const isPrintable =
		isManifold && isWatertight && degenerateTriangleCount === 0 && duplicateTriangleCount === 0;

	const report: MeshCheckReport = {
		triangleCount,
		degenerateTriangleCount,
		duplicateTriangleCount,
		boundaryEdgeCount,
		nonManifoldEdgeCount,
		isManifold,
		isWatertight,
		isPrintable
	};
	if (bad) {
		report.badPositions = new Float32Array(bad);
		report.badEdgePositions = new Float32Array(badEdges);
	}
	return report;
}

function analyseTriangles(
	triangleCount: number,
	cornerAt: (t: number, c: 0 | 1 | 2) => { x: number; y: number; z: number; id: number },
	collectBad: boolean
): MeshCheckReport {
	const edgeUse = new Map<string, number>();
	const triSeen = new Map<string, number>();
	const bad: Array<number> = collectBad ? [] : (null as never);
	const repX: Array<number> = [];
	const repY: Array<number> = [];
	const repZ: Array<number> = [];

	let degenerateTriangleCount = 0;
	let duplicateTriangleCount = 0;

	const addEdge = (a: number, b: number) => {
		const id = a < b ? `${a}|${b}` : `${b}|${a}`;
		edgeUse.set(id, (edgeUse.get(id) ?? 0) + 1);
	};

	for (let t = 0; t < triangleCount; t++) {
		const a = cornerAt(t, 0);
		const b = cornerAt(t, 1);
		const c = cornerAt(t, 2);

		const ensureRep = (corner: { x: number; y: number; z: number; id: number }) => {
			if (repX[corner.id] === undefined) {
				repX[corner.id] = corner.x;
				repY[corner.id] = corner.y;
				repZ[corner.id] = corner.z;
			}
		};
		ensureRep(a);
		ensureRep(b);
		ensureRep(c);

		// A triangle is only truly degenerate when two of its corners share an id
		// (zero-length edge). Thin three-distinct-vertex slivers are NOT degenerate:
		// their edges are real and balance with neighbours. (Area thresholds are also
		// translation-sensitive under Float32, so we never use them.)
		const allDistinct = a.id !== b.id && b.id !== c.id && a.id !== c.id;
		if (!allDistinct) {
			degenerateTriangleCount++;
			if (bad) {
				bad.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
			}
			continue;
		}

		const triId = [a.id, b.id, c.id].sort((m, n) => m - n).join('#');
		const seen = triSeen.get(triId) ?? 0;
		triSeen.set(triId, seen + 1);
		if (seen > 0) {
			duplicateTriangleCount++;
			if (bad) {
				bad.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
			}
		}

		addEdge(a.id, b.id);
		addEdge(b.id, c.id);
		addEdge(c.id, a.id);
	}

	return finishReport(
		triangleCount,
		degenerateTriangleCount,
		duplicateTriangleCount,
		edgeUse,
		repX,
		repY,
		repZ,
		bad,
		collectBad
	);
}

export function checkMesh(
	positions: ArrayLike<number>,
	options: MeshCheckOptions = {}
): MeshCheckReport {
	const tol = options.tolerance ?? DEFAULT_TOLERANCE;
	const invTol = 1 / tol;
	const tolSq = tol * tol;

	// Weld coincident corners to a stable integer id. A fixed `Math.round` grid is
	// NOT enough on its own: two corners that are the same point to within a few
	// float ULPs (the hard-edge seams `mergeVertices` leaves unwelded) can land on
	// opposite sides of a rounding boundary and split into different cells, so a
	// closed solid reads as full of boundary edges once it is translated away from
	// the origin (e.g. when laid out next to another die). To stay translation
	// invariant we snap to a grid for the lookup but also scan the neighbouring
	// cells and merge with any representative already within `tol`.
	const cells = new Map<string, number>();
	const idRepX: Array<number> = [];
	const idRepY: Array<number> = [];
	const idRepZ: Array<number> = [];
	const cellKey = (ix: number, iy: number, iz: number): string => `${ix},${iy},${iz}`;
	const idOf: CornerId = (x, y, z) => {
		const ix = Math.round(x * invTol);
		const iy = Math.round(y * invTol);
		const iz = Math.round(z * invTol);
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				for (let dz = -1; dz <= 1; dz++) {
					const found = cells.get(cellKey(ix + dx, iy + dy, iz + dz));
					if (found === undefined) {
						continue;
					}
					const ex = x - idRepX[found];
					const ey = y - idRepY[found];
					const ez = z - idRepZ[found];
					if (ex * ex + ey * ey + ez * ez <= tolSq) {
						return found;
					}
				}
			}
		}
		const id = idRepX.length;
		idRepX.push(x);
		idRepY.push(y);
		idRepZ.push(z);
		cells.set(cellKey(ix, iy, iz), id);
		return id;
	};

	const triangleCount = Math.floor(positions.length / 9);
	return analyseTriangles(
		triangleCount,
		(t, c) => {
			const o = t * 9 + c * 3;
			const x = positions[o];
			const y = positions[o + 1];
			const z = positions[o + 2];
			return { x, y, z, id: idOf(x, y, z) };
		},
		!!options.collectBad
	);
}

// Topology check for an already-indexed solid (Manifold MeshGL / 3MF). Vertex
// identity is the index — no geometric weld — so short but intentional edges
// below mesh_check's weld tolerance are not collapsed into false degenerates.
export function checkIndexedMesh(
	positions: ArrayLike<number>,
	indices: ArrayLike<number>,
	options: Pick<MeshCheckOptions, 'collectBad'> = {}
): MeshCheckReport {
	const triangleCount = Math.floor(indices.length / 3);
	return analyseTriangles(
		triangleCount,
		(t, c) => {
			const vi = indices[t * 3 + c];
			const o = vi * 3;
			return {
				x: positions[o],
				y: positions[o + 1],
				z: positions[o + 2],
				id: vi
			};
		},
		!!options.collectBad
	);
}

// Combine several per-mesh reports (e.g. a die plus its build-option artifacts)
// into one. Counts add up; the booleans are AND-ed. `badPositions` are
// concatenated when present.
export function mergeMeshReports(reports: Array<MeshCheckReport>): MeshCheckReport {
	const merged: MeshCheckReport = {
		triangleCount: 0,
		degenerateTriangleCount: 0,
		duplicateTriangleCount: 0,
		boundaryEdgeCount: 0,
		nonManifoldEdgeCount: 0,
		isManifold: true,
		isWatertight: true,
		isPrintable: true
	};
	const bads: Array<Float32Array> = [];
	const badEdges: Array<Float32Array> = [];
	for (const r of reports) {
		merged.triangleCount += r.triangleCount;
		merged.degenerateTriangleCount += r.degenerateTriangleCount;
		merged.duplicateTriangleCount += r.duplicateTriangleCount;
		merged.boundaryEdgeCount += r.boundaryEdgeCount;
		merged.nonManifoldEdgeCount += r.nonManifoldEdgeCount;
		merged.isManifold &&= r.isManifold;
		merged.isWatertight &&= r.isWatertight;
		merged.isPrintable &&= r.isPrintable;
		if (r.badPositions && r.badPositions.length) {
			bads.push(r.badPositions);
		}
		if (r.badEdgePositions && r.badEdgePositions.length) {
			badEdges.push(r.badEdgePositions);
		}
	}
	const concat = (parts: Array<Float32Array>): Float32Array => {
		const total = parts.reduce((n, a) => n + a.length, 0);
		const out = new Float32Array(total);
		let off = 0;
		for (const a of parts) {
			out.set(a, off);
			off += a.length;
		}
		return out;
	};
	if (bads.length) {
		merged.badPositions = concat(bads);
	}
	if (badEdges.length) {
		merged.badEdgePositions = concat(badEdges);
	}
	return merged;
}
