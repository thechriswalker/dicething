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
	// triangles with ~zero area (two coincident corners, or collinear corners).
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
	// triangles whose area is <= this (mm^2) are reported as degenerate.
	areaEpsilon?: number;
	// also gather the positions of problem triangles into `badPositions`.
	collectBad?: boolean;
};

const DEFAULT_TOLERANCE = 1e-4;
const DEFAULT_AREA_EPSILON = 1e-6;

export function checkMesh(
	positions: ArrayLike<number>,
	options: MeshCheckOptions = {}
): MeshCheckReport {
	const tol = options.tolerance ?? DEFAULT_TOLERANCE;
	const areaEps = options.areaEpsilon ?? DEFAULT_AREA_EPSILON;
	const invTol = 1 / tol;

	const keyOf = (x: number, y: number, z: number): string =>
		`${Math.round(x * invTol)},${Math.round(y * invTol)},${Math.round(z * invTol)}`;

	const triangleCount = Math.floor(positions.length / 9);

	// edge id -> number of (non-degenerate) triangles touching it.
	const edgeUse = new Map<string, number>();
	// triangle id -> times seen, for duplicate detection.
	const triSeen = new Map<string, number>();
	const bad: Array<number> = options.collectBad ? [] : (null as never);

	let degenerateTriangleCount = 0;
	let duplicateTriangleCount = 0;

	const addEdge = (a: string, b: string) => {
		const id = a < b ? `${a}|${b}` : `${b}|${a}`;
		edgeUse.set(id, (edgeUse.get(id) ?? 0) + 1);
	};

	for (let t = 0; t < triangleCount; t++) {
		const o = t * 9;
		const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
		const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
		const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];

		const ka = keyOf(ax, ay, az);
		const kb = keyOf(bx, by, bz);
		const kc = keyOf(cx, cy, cz);

		// area = half the magnitude of (b-a) x (c-a).
		const ux = bx - ax, uy = by - ay, uz = bz - az;
		const vx = cx - ax, vy = cy - ay, vz = cz - az;
		const crx = uy * vz - uz * vy;
		const cry = uz * vx - ux * vz;
		const crz = ux * vy - uy * vx;
		const area = 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);

		const allDistinct = ka !== kb && kb !== kc && ka !== kc;
		if (!allDistinct || area <= areaEps) {
			degenerateTriangleCount++;
			if (bad) {
				bad.push(ax, ay, az, bx, by, bz, cx, cy, cz);
			}
			// degenerate triangles carry meaningless edges; keep them out of the
			// manifold/boundary analysis so the counts describe the real surface.
			continue;
		}

		const triId = [ka, kb, kc].sort().join('#');
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
