// Structural checks for an exported (print-ready) mesh: is it a closed,
// manifold solid with no degenerate or duplicate triangles? This is the same
// class of checks an external STL repair tool runs ("watertight", "manifold",
// "no degenerate triangles"), so we can flag a die as un-printable before the
// user ever leaves the app.
//
// The input is a flat, NON-INDEXED position buffer (9 numbers per triangle),
// exactly what `Builder.export()` produces and what an STL stores. There is no
// three.js dependency here on purpose so the whole thing can run in a tiny
// web worker (see mesh-check.worker.ts) with nothing else loaded.
//
// Vertices are welded by quantising to a tolerance grid before comparing, so
// the hard-edge seams between adjacent faces (whose coincident corners can
// differ by a few float ULPs, and which `mergeVertices` deliberately leaves
// unwelded because their normals differ) are still recognised as the same
// point. Without this every face edge would look like an open boundary.

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
};

export type MeshCheckOptions = {
	// vertex-weld tolerance in mm. coincident corners closer than this are
	// treated as the same vertex. mirrors three's mergeVertices default.
	tolerance?: number;
	// also gather the positions of problem triangles into `badPositions`.
	collectBad?: boolean;
};

const DEFAULT_TOLERANCE = 1e-4;

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
	const repX: Array<number> = [];
	const repY: Array<number> = [];
	const repZ: Array<number> = [];
	const cellKey = (ix: number, iy: number, iz: number): string => `${ix},${iy},${iz}`;
	const idOf = (x: number, y: number, z: number): number => {
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
					const ex = x - repX[found];
					const ey = y - repY[found];
					const ez = z - repZ[found];
					if (ex * ex + ey * ey + ez * ez <= tolSq) {
						return found;
					}
				}
			}
		}
		const id = repX.length;
		repX.push(x);
		repY.push(y);
		repZ.push(z);
		cells.set(cellKey(ix, iy, iz), id);
		return id;
	};

	const triangleCount = Math.floor(positions.length / 9);

	// edge id -> number of (non-degenerate) triangles touching it.
	const edgeUse = new Map<string, number>();
	// triangle id -> times seen, for duplicate detection.
	const triSeen = new Map<string, number>();
	const bad: Array<number> = options.collectBad ? [] : (null as never);

	let degenerateTriangleCount = 0;
	let duplicateTriangleCount = 0;

	const addEdge = (a: number, b: number) => {
		const id = a < b ? `${a}|${b}` : `${b}|${a}`;
		edgeUse.set(id, (edgeUse.get(id) ?? 0) + 1);
	};

	for (let t = 0; t < triangleCount; t++) {
		const o = t * 9;
		const ax = positions[o],
			ay = positions[o + 1],
			az = positions[o + 2];
		const bx = positions[o + 3],
			by = positions[o + 4],
			bz = positions[o + 5];
		const cx = positions[o + 6],
			cy = positions[o + 7],
			cz = positions[o + 8];

		const ka = idOf(ax, ay, az);
		const kb = idOf(bx, by, bz);
		const kc = idOf(cx, cy, cz);

		// A triangle is only truly degenerate when two of its corners weld to the
		// same vertex: it then has a zero-length edge and no real surface. We must
		// NOT judge this by area. A thin sliver with three distinct vertices (e.g.
		// near-collinear engraving tessellation) still has three real edges that
		// balance with its neighbours; dropping it would orphan those edges and make
		// a closed solid read as full of boundary holes. Worse, area is computed in
		// Float32 after layout, so a sub-micron sliver flips above/below any fixed
		// area threshold purely depending on where the die sits in the export grid.
		const allDistinct = ka !== kb && kb !== kc && ka !== kc;
		if (!allDistinct) {
			degenerateTriangleCount++;
			if (bad) {
				bad.push(ax, ay, az, bx, by, bz, cx, cy, cz);
			}
			// collapsed triangles carry a meaningless zero-length edge; keep them out
			// of the manifold/boundary analysis so the counts describe the real surface.
			continue;
		}

		const triId = [ka, kb, kc].sort((m, n) => m - n).join('#');
		const seen = triSeen.get(triId) ?? 0;
		triSeen.set(triId, seen + 1);
		if (seen > 0) {
			duplicateTriangleCount++;
			if (bad) {
				bad.push(ax, ay, az, bx, by, bz, cx, cy, cz);
			}
		}

		addEdge(ka, kb);
		addEdge(kb, kc);
		addEdge(kc, ka);
	}

	let boundaryEdgeCount = 0;
	let nonManifoldEdgeCount = 0;
	for (const count of edgeUse.values()) {
		if (count === 1) {
			boundaryEdgeCount++;
		} else if (count > 2) {
			nonManifoldEdgeCount++;
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
	}
	return report;
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
	}
	if (bads.length) {
		const total = bads.reduce((n, a) => n + a.length, 0);
		const out = new Float32Array(total);
		let off = 0;
		for (const a of bads) {
			out.set(a, off);
			off += a.length;
		}
		merged.badPositions = out;
	}
	return merged;
}
