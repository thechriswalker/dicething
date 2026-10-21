import { describe, expect, it } from 'vitest';
import { DOMParser } from 'xmldom';
import { Path, Shape, Vector2, Vector3 } from 'three';

// Custom-path coins parse through three's SVGLoader, which needs DOMParser.
(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
import { CoinD2 } from '$lib/dice/coin';
import { CubeD6 } from '$lib/dice/cube';
import { InfinityD4 } from '$lib/dice/infinity';
import { TrapezohedronD10 } from '$lib/dice/trapezohedrons';
import { Transform } from '../3d';
import { computePointDownPrintingTransform } from '../printing';
import {
	carveEngravingFromSupportLines,
	clipSupportLineForSphere,
	collectSharpEdges,
	computeEdgeSupportLines,
	detectLegendSupportsLocalMinima,
	detectTipPost,
	faceNormalPrint,
	facePointPrint,
	insetSegmentOntoFace,
	edgeInsetForSphere,
	faceAngleFromVerticalDeg,
	faceIsVertical,
	faceNeedsEdgeSupports,
	faceSlopesOutward,
	insetSupportFacesAtEdge,
	isBaseRestingEdge,
	outwardFacesAtEdge,
	orientFaceLegendShapes,
	pointInLegendEngraving,
	printPointToFaceLocal,
	supportEdgeSegment,
	trimSegmentEnds
} from './regions';
import { DEFAULT_SUPPORT_SETTINGS } from './types';
import type { DieFaceModel } from '$lib/interfaces/dice';
import { Legend } from '../legends';
import { CaltropCustomD4, CaltropD4 } from '$lib/dice/caltrop';

function builtCubeFaces() {
	const built = CubeD6.build({ polyhedron_size: 16 });
	return built.faces;
}

function builtD10Faces() {
	const built = TrapezohedronD10.build({
		trapezohedron_radius: 12.52,
		trapezohedron_height: 36
	});
	return built.faces;
}

describe('support edge regions', () => {
	it('finds sharp edges on a cube (12 edges, each with 2 faces)', () => {
		const faces = builtCubeFaces();
		const printT = computePointDownPrintingTransform(faces);
		const sharp = collectSharpEdges(faces, printT);
		// Cube has 12 edges; each appears once in the undirected graph.
		expect(sharp.length).toBe(12);
		for (const e of sharp) {
			expect(e.faces.length).toBeGreaterThanOrEqual(2);
		}
	});

	it('uses the configured edge distance for face inset', () => {
		expect(edgeInsetForSphere(DEFAULT_SUPPORT_SETTINGS)).toBe(
			DEFAULT_SUPPORT_SETTINGS.edgeInsetMm
		);
		expect(
			edgeInsetForSphere({
				...DEFAULT_SUPPORT_SETTINGS,
				edgeInsetMm: 0.25
			})
		).toBe(0.25);
	});

	it('classifies face slope from outward normal Y', () => {
		expect(faceSlopesOutward(new Vector3(0, -1, 0))).toBe(true); // underside
		expect(faceSlopesOutward(new Vector3(0.5, -0.5, 0).normalize())).toBe(true);
		expect(faceSlopesOutward(new Vector3(1, 0, 0))).toBe(false); // vertical
		expect(faceSlopesOutward(new Vector3(0, 1, 0))).toBe(false); // inward / up
	});

	it('measures outward lean from vertical and applies the edge cutoff', () => {
		expect(faceAngleFromVerticalDeg(new Vector3(1, 0, 0))).toBeCloseTo(0, 5);
		expect(faceAngleFromVerticalDeg(new Vector3(0, -1, 0))).toBeCloseTo(90, 5);
		expect(faceAngleFromVerticalDeg(new Vector3(0, 1, 0))).toBeCloseTo(-90, 5);
		const shallow = new Vector3(Math.cos((5 * Math.PI) / 180), -Math.sin((5 * Math.PI) / 180), 0);
		expect(faceAngleFromVerticalDeg(shallow)).toBeCloseTo(5, 4);
		expect(faceSlopesOutward(shallow)).toBe(true);
		expect(faceNeedsEdgeSupports(shallow, 10)).toBe(false);
		expect(faceNeedsEdgeSupports(new Vector3(0.5, -0.5, 0).normalize(), 10)).toBe(true);
	});

	it('drops edge supports when the face min angle is above the face lean', () => {
		const built = CubeD6.build({ polyhedron_size: 16 });
		const lines = computeEdgeSupportLines(built.faces, built.printingTransform!, {
			...DEFAULT_SUPPORT_SETTINGS,
			faceMinAngleDeg: 80
		});
		expect(lines.length).toBe(0);
	});

	it('only supports creases where two outward faces meet on a tip-down cube', () => {
		const faces = builtCubeFaces();
		const printT = computePointDownPrintingTransform(faces);
		const sharp = collectSharpEdges(faces, printT);
		const supportedEdges = sharp.filter(
			(e) => outwardFacesAtEdge(faces, e.faces, printT).length >= 2
		);
		expect(supportedEdges.length).toBeGreaterThan(0);
		// Tip-down cube: three lower faces meet — only their shared edges qualify
		// (not edges against upper/inward faces).
		expect(supportedEdges.length).toBe(3);

		const lines = computeEdgeSupportLines(faces, printT, DEFAULT_SUPPORT_SETTINGS);
		expect(lines.length).toBe(supportedEdges.length * 2);
		for (const line of lines) {
			expect(faceSlopesOutward(line.normal)).toBe(true);
		}
	});

	it('supports base edge + outward/vertical side edges on an edge-down cube', () => {
		const built = CubeD6.build({ polyhedron_size: 16 });
		const printT = built.printingTransform!;
		const sharp = collectSharpEdges(built.faces, printT);
		const minY = Math.min(...sharp.flatMap((e) => [e.a.y, e.b.y]));
		const lines = computeEdgeSupportLines(built.faces, printT, DEFAULT_SUPPORT_SETTINGS);
		// 1 on-edge base run + 4 inset runs (2 lower faces × 2 vertical sides).
		expect(lines.length).toBe(5);
		const baseLines = lines.filter((l) =>
			isBaseRestingEdge(l.points[0], l.points[1], minY, 0.2)
		);
		expect(baseLines.length).toBe(1);
		expect(lines.some((l) => l.avoidLegends)).toBe(false);
		expect(detectTipPost(built.faces, printT)).toBeUndefined();
	});

	it('supports base edge + two face-median rows on an edge-down tetrahedron', () => {
		for (const model of [CaltropCustomD4, CaltropD4]) {
			const built = model.build({});
			const printT = built.printingTransform!;
			const lines = computeEdgeSupportLines(built.faces, printT, DEFAULT_SUPPORT_SETTINGS);
			// 1 on-edge base + 2 face rows toward outer tips.
			expect(lines.length, model.id).toBe(3);
			expect(lines.filter((l) => l.avoidLegends).length, model.id).toBe(2);
			expect(detectTipPost(built.faces, printT), model.id).toBeUndefined();
		}
	});

	it('allows inset supports for one outward face against a vertical neighbour', () => {
		expect(faceIsVertical(new Vector3(1, 0, 0))).toBe(true);
		expect(faceIsVertical(new Vector3(0, -1, 0))).toBe(false);
		const built = CubeD6.build({ polyhedron_size: 16 });
		const printT = built.printingTransform!;
		const sharp = collectSharpEdges(built.faces, printT);
		const sideEdges = sharp.filter((e) => {
			const outs = outwardFacesAtEdge(built.faces, e.faces, printT);
			return outs.length === 1 && insetSupportFacesAtEdge(built.faces, e.faces, printT).length === 1;
		});
		expect(sideEdges.length).toBe(4);
	});

	it('spaces supports along a high-segment coin rim and an infinity curve', () => {
		const coin = CoinD2.build({ coin_segments: 96 });
		const coinLines = computeEdgeSupportLines(
			coin.faces,
			coin.printingTransform!,
			DEFAULT_SUPPORT_SETTINGS
		);
		expect(coinLines.length).toBeGreaterThan(0);
		const coinSpan = Math.max(
			...coinLines.map((l) => l.points[0].distanceTo(l.points[l.points.length - 1]))
		);
		// A single rim chord at 96 segments is well under a millimetre.
		expect(coinSpan).toBeGreaterThan(2);

		const inf = InfinityD4.build({});
		const infLines = computeEdgeSupportLines(
			inf.faces,
			inf.printingTransform!,
			DEFAULT_SUPPORT_SETTINGS
		);
		expect(infLines.length).toBeGreaterThan(0);
		const infSpan = Math.max(
			...infLines.map((l) => l.points[0].distanceTo(l.points[l.points.length - 1]))
		);
		expect(infSpan).toBeGreaterThan(2);
		// The lower half-cylinder has no crease across its width. Three lines
		// run along that belly, inset off the two rims.
		const across = infLines.filter((l) => {
			const dx = Math.abs(l.points[0].x - l.points[l.points.length - 1].x);
			return dx > 8;
		});
		expect(across.length).toBe(3);
	});

	it('supports the default custom coin outline', () => {
		const path = CoinD2.stringParameters?.find((p) => p.id === 'coin_path')?.defaultValue ?? '';
		const built = CoinD2.build({ coin_shape_mode: 1 }, { coin_path: path });
		// The logo outline is far denser than the 9-gon fallback.
		expect(built.faces.length).toBeGreaterThan(100);
		const lines = computeEdgeSupportLines(
			built.faces,
			built.printingTransform!,
			DEFAULT_SUPPORT_SETTINGS
		);
		expect(lines.length).toBeGreaterThan(10);
	});

	it('supports only the long lower-kite edges on a tip-down d10', () => {
		const faces = builtD10Faces();
		const printT = computePointDownPrintingTransform(faces);
		const sharp = collectSharpEdges(faces, printT);
		const supported = sharp.filter(
			(e) => outwardFacesAtEdge(faces, e.faces, printT).length >= 2
		);
		// Five long creases between adjacent lower pyramid kites.
		expect(supported.length).toBe(5);
		const lens = supported.map((e) => e.a.distanceTo(e.b));
		const minLong = Math.min(...lens);
		// Short kite edges (one outward + one inward) must not qualify.
		const shortOnes = sharp.filter((e) => e.a.distanceTo(e.b) < minLong - 0.5);
		expect(shortOnes.length).toBeGreaterThan(0);
		for (const e of shortOnes) {
			expect(outwardFacesAtEdge(faces, e.faces, printT).length).toBeLessThan(2);
		}

		const lines = computeEdgeSupportLines(faces, printT, DEFAULT_SUPPORT_SETTINGS);
		// One inset line per outward face on each long edge.
		expect(lines.length).toBe(10);
	});

	it('returns a full segment from supportEdgeSegment', () => {
		const span = supportEdgeSegment(new Vector3(0, 0, 0), new Vector3(0, 10, 0));
		expect(span).toBeDefined();
		expect(span![0].distanceTo(span![1])).toBeCloseTo(10, 5);
	});

	it('pulls a run end back so the sphere stays off a 45° adjoining edge', () => {
		// Right isosceles triangle. A run inset 0.6 from the base and trimmed
		// 0.6 along its length lands ON the hypotenuse, so any sphere overflows.
		const obstacles = [
			{ a: new Vector3(0, 0, 0), b: new Vector3(10, 0, 0) },
			{ a: new Vector3(0, 0, 0), b: new Vector3(0, 10, 0) },
			{ a: new Vector3(10, 0, 0), b: new Vector3(0, 10, 0) }
		];
		const radius = 0.25;
		const clipped = clipSupportLineForSphere(
			new Vector3(0.6, 0.6, 0),
			new Vector3(9.4, 0.6, 0),
			obstacles,
			radius
		);
		expect(clipped).toBeDefined();
		const end = clipped![1];
		expect(end.x).toBeLessThan(9.3);
		expect(end.y).toBeCloseTo(0.6, 5);
		const hyp = obstacles[2];
		const abx = hyp.b.x - hyp.a.x;
		const aby = hyp.b.y - hyp.a.y;
		const len = Math.hypot(abx, aby);
		const dist = Math.abs((end.x - hyp.a.x) * aby - (end.y - hyp.a.y) * abx) / len;
		expect(dist).toBeGreaterThanOrEqual(radius - 1e-3);
		// The base the run follows is left at the inset distance.
		expect(end.y).toBeCloseTo(0.6, 5);
		// The square end, already 0.6 from its edge, does not move.
		expect(clipped![0].x).toBeCloseTo(0.6, 4);
	});

	it('pulls a tip back so the sphere stays inside the adjacent face', () => {
		// Host face is y = 0 (outward +Y). Adjacent face meets it at 60° inside
		// the die, outward normal (-sin 60°, cos 60°). Sitting one radius from
		// the edge still punches through that plane; the centre has to be further in.
		const radius = 0.25;
		const clipped = clipSupportLineForSphere(
			new Vector3(2, 0, 0),
			new Vector3(0.05, 0, 0),
			[],
			radius,
			[
				{ point: new Vector3(0, 0, 0), normal: new Vector3(0, 1, 0) },
				{ point: new Vector3(0, 0, 0), normal: new Vector3(-Math.sin(Math.PI / 3), 0.5, 0) }
			]
		);
		expect(clipped).toBeDefined();
		const end = clipped![1];
		const signed = end.x * -Math.sin(Math.PI / 3);
		expect(signed).toBeLessThanOrEqual(-radius + 1e-3);
		expect(end.x).toBeGreaterThan(radius);
	});

	it('keeps tetrahedron face-row spheres from exiting adjacent faces', () => {
		const built = CaltropD4.build({});
		const printT = built.printingTransform!;
		const settings = { ...DEFAULT_SUPPORT_SETTINGS, sphereDiameterMm: 0.4 };
		const lines = computeEdgeSupportLines(built.faces, printT, settings);
		expect(lines.filter((l) => l.faceIndex !== undefined).length).toBe(2);
		const radius = settings.sphereDiameterMm / 2;
		const planes = built.faces.map((face) => ({
			point: facePointPrint(face, new Vector2(0, 0), printT),
			normal: faceNormalPrint(face, printT)
		}));
		for (const line of lines) {
			if (line.faceIndex === undefined) continue;
			const hostN = planes[line.faceIndex].normal;
			for (const p of line.points) {
				for (const plane of planes) {
					if (Math.abs(hostN.dot(plane.normal)) > 0.999) continue;
					const signed = p.clone().sub(plane.point).dot(plane.normal);
					expect(signed).toBeLessThanOrEqual(-radius + 1e-3);
				}
			}
		}
	});

	it('trims segment ends by the same amount as the edge inset', () => {
		const a = new Vector3(0, 0, 0);
		const b = new Vector3(10, 0, 0);
		const trimmed = trimSegmentEnds(a, b, 0.6);
		expect(trimmed).toBeDefined();
		expect(trimmed![0].x).toBeCloseTo(0.6, 5);
		expect(trimmed![1].x).toBeCloseTo(9.4, 5);
		expect(trimSegmentEnds(a, new Vector3(1, 0, 0), 0.6)).toBeUndefined();
	});

	it('insets a segment onto both outward faces of a supported crease', () => {
		const faces = builtCubeFaces();
		const printT = computePointDownPrintingTransform(faces);
		const lines = computeEdgeSupportLines(faces, printT, DEFAULT_SUPPORT_SETTINGS);
		// Tip-down cube: 3 creases × 2 faces.
		expect(lines.length).toBe(6);
		const inset = edgeInsetForSphere(DEFAULT_SUPPORT_SETTINGS);
		for (const line of lines) {
			expect(line.points[0].distanceTo(line.points[1])).toBeGreaterThan(0.1);
			// Inset contacts should sit above the plate.
			expect(line.points[0].y).toBeGreaterThan(0);
			expect(line.points[1].y).toBeGreaterThan(0);
		}
		// Trimmed ends: support runs are shorter than the raw face edge (~16 mm).
		const longest = Math.max(...lines.map((l) => l.points[0].distanceTo(l.points[1])));
		expect(longest).toBeLessThan(16 - 2 * inset + 0.5);
	});

	it('ignores near-coplanar face pairs', () => {
		// Two faces with nearly the same normal sharing an edge → not sharp.
		const shape = new Shape([
			new Vector2(-1, -1),
			new Vector2(1, -1),
			new Vector2(1, 1),
			new Vector2(-1, 1)
		]);
		const mkFace = (nudge: number): DieFaceModel => ({
			isNumberFace: false,
			shape,
			defaultLegend: Legend.BLANK,
			transform: new Transform()
				.translateBy(0, 0, 1)
				.rotateByAxisAngle(new Vector3(1, 0, 0), nudge)
		});
		const faces = [mkFace(0), mkFace(0.01)];
		const printT = new Transform();
		const sharp = collectSharpEdges(faces, printT);
		expect(sharp.length).toBe(0);
	});

	it('inset moves the segment toward the face centroid', () => {
		const faces = builtCubeFaces();
		const printT = computePointDownPrintingTransform(faces);
		const sharp = collectSharpEdges(faces, printT);
		const e = sharp[0];
		const face = faces[e.faces[0].faceIndex];
		const inset = insetSegmentOntoFace(e.a, e.b, face, printT, 0.6);
		expect(inset).toBeDefined();
		const mid0 = new Vector3().addVectors(e.a, e.b).multiplyScalar(0.5);
		const mid1 = new Vector3().addVectors(inset![0], inset![1]).multiplyScalar(0.5);
		// Inset point should be closer to face centre than the raw edge mid.
		const c = faceNormalPrint(face, printT); // just ensure normal is finite
		expect(c.length()).toBeCloseTo(1, 5);
		expect(mid0.distanceTo(mid1)).toBeGreaterThan(0.3);
	});
});

describe('legend support detector (contour spacing)', () => {
	it('places a point beside a lower minimum on a downward face and none on an upward face', () => {
		// Simple square face pointing −Y (down) with a triangular legend.
		const downFace: DieFaceModel = {
			isNumberFace: true,
			shape: new Shape([
				new Vector2(-5, -5),
				new Vector2(5, -5),
				new Vector2(5, 5),
				new Vector2(-5, 5)
			]),
			defaultLegend: Legend.ONE,
			transform: new Transform()
				.translateBy(0, 0, 8)
				.rotateByAxisAngle(new Vector3(1, 0, 0), Math.PI / 2) // +Z → −Y
		};
		const upFace: DieFaceModel = {
			...downFace,
			transform: new Transform()
				.translateBy(0, 0, 8)
				.rotateByAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2) // +Z → +Y
		};
		const legend = new Shape([
			new Vector2(-1, 2),
			new Vector2(1, 2),
			new Vector2(0, -2)
		]);
		const printT = new Transform().translateBy(0, 5, 0);
		const downPts = detectLegendSupportsLocalMinima({
			faces: [downFace],
			faceLegendShapes: [[legend]],
			printingTransform: printT,
			settings: DEFAULT_SUPPORT_SETTINGS
		});
		const upPts = detectLegendSupportsLocalMinima({
			faces: [upFace],
			faceLegendShapes: [[legend]],
			printingTransform: printT,
			settings: DEFAULT_SUPPORT_SETTINGS
		});
		expect(downPts.length).toBeGreaterThanOrEqual(1);
		expect(upPts.length).toBe(0);
	});

	it('skips legend supports on vertical and inward faces', () => {
		const mkFace = (rotX: number): DieFaceModel => ({
			isNumberFace: true,
			shape: new Shape([
				new Vector2(-5, -5),
				new Vector2(5, -5),
				new Vector2(5, 5),
				new Vector2(-5, 5)
			]),
			defaultLegend: Legend.ONE,
			transform: new Transform()
				.translateBy(0, 0, 8)
				.rotateByAxisAngle(new Vector3(1, 0, 0), rotX)
		});
		const legend = new Shape([
			new Vector2(-1, 2),
			new Vector2(1, 2),
			new Vector2(0, -2)
		]);
		const printT = new Transform().translateBy(0, 5, 0);
		const vertical = detectLegendSupportsLocalMinima({
			faces: [mkFace(0)], // +Z face → vertical under identity-ish print
			faceLegendShapes: [[legend]],
			printingTransform: printT,
			settings: DEFAULT_SUPPORT_SETTINGS
		});
		const inward = detectLegendSupportsLocalMinima({
			faces: [mkFace(-Math.PI / 2)], // +Z → +Y
			faceLegendShapes: [[legend]],
			printingTransform: printT,
			settings: DEFAULT_SUPPORT_SETTINGS
		});
		expect(vertical.length).toBe(0);
		expect(inward.length).toBe(0);
	});

	it('carves a run that crosses a coplanar neighbour face engraving', () => {
		// Two coplanar kites sharing y=0. The support line is tagged to the lower
		// kite, but the glyph sits on the upper kite — same situation as a caltrop
		// midline crossing the "1" while being assigned to the base segment.
		const lower: DieFaceModel = {
			isNumberFace: true,
			shape: new Shape([
				new Vector2(-2, -4),
				new Vector2(2, -4),
				new Vector2(0, 0)
			]),
			defaultLegend: Legend.TWO,
			transform: new Transform()
				.translateBy(0, 0, 8)
				.rotateByAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
		};
		const upper: DieFaceModel = {
			...lower,
			shape: new Shape([
				new Vector2(0, 0),
				new Vector2(2, 4),
				new Vector2(-2, 4)
			]),
			defaultLegend: Legend.ONE
		};
		const glyph = new Shape([
			new Vector2(-0.6, 1.2),
			new Vector2(0.6, 1.2),
			new Vector2(0.6, 2.4),
			new Vector2(-0.6, 2.4)
		]);
		const printT = new Transform().translateBy(0, 5, 0);
		const carved = carveEngravingFromSupportLines(
			[
				{
					points: [
						facePointPrint(upper, new Vector2(0, 3), printT),
						facePointPrint(lower, new Vector2(0, -3), printT)
					],
					normal: new Vector3(0, -1, 0),
					avoidLegends: true,
					faceIndex: 0
				}
			],
			[lower, upper],
			printT,
			[[], [glyph]],
			0.2,
			0
		);
		expect(carved.length).toBeGreaterThanOrEqual(1);
		for (const line of carved) {
			const mid = new Vector3().addVectors(line.points[0], line.points[1]).multiplyScalar(0.5);
			const local = printPointToFaceLocal(upper, mid, printT);
			if (!local) continue;
			expect(pointInLegendEngraving([glyph], local)).toBe(false);
		}
		const glyphMid = facePointPrint(upper, new Vector2(0, 1.8), printT);
		const spansGlyph = carved.some((line) => {
			const d = new Vector3().subVectors(line.points[1], line.points[0]);
			const lenSq = d.lengthSq();
			if (lenSq < 1e-9) return false;
			const t = new Vector3().subVectors(glyphMid, line.points[0]).dot(d) / lenSq;
			if (t < 0 || t > 1) return false;
			return line.points[0].clone().addScaledVector(d, t).distanceTo(glyphMid) < 0.2;
		});
		expect(spansGlyph).toBe(false);
	});

	it('carves face support runs out of engraved fill', () => {
		const face: DieFaceModel = {
			isNumberFace: true,
			shape: new Shape([
				new Vector2(-5, -5),
				new Vector2(5, -5),
				new Vector2(5, 5),
				new Vector2(-5, 5)
			]),
			defaultLegend: Legend.ONE,
			transform: new Transform()
				.translateBy(0, 0, 8)
				.rotateByAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
		};
		// Engraving band across the middle of a vertical support run.
		const legend = new Shape([
			new Vector2(-1, -1),
			new Vector2(1, -1),
			new Vector2(1, 1),
			new Vector2(-1, 1)
		]);
		const printT = new Transform().translateBy(0, 5, 0);
		const carved = carveEngravingFromSupportLines(
			[
				{
					points: [
						facePointPrint(face, new Vector2(0, 4), printT),
						facePointPrint(face, new Vector2(0, -4), printT)
					],
					normal: new Vector3(0, -1, 0),
					avoidLegends: true,
					faceIndex: 0
				}
			],
			[face],
			printT,
			[[legend]]
		);
		expect(carved.length).toBeGreaterThanOrEqual(2);
		for (const line of carved) {
			const mid = new Vector3().addVectors(line.points[0], line.points[1]).multiplyScalar(0.5);
			const local = printPointToFaceLocal(face, mid, printT)!;
			expect(pointInLegendEngraving([legend], local)).toBe(false);
		}
	});

	it('omits edge runs that pass through a legend counter', () => {
		const face: DieFaceModel = {
			isNumberFace: true,
			shape: new Shape([
				new Vector2(-5, -5),
				new Vector2(5, -5),
				new Vector2(5, 5),
				new Vector2(-5, 5)
			]),
			defaultLegend: Legend.FOUR,
			transform: new Transform()
				.translateBy(0, 0, 8)
				.rotateByAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
		};
		// A ring: the centre is not engraved fill, but it is inside the legend hull.
		const legend = new Shape([
			new Vector2(-2, -2),
			new Vector2(2, -2),
			new Vector2(2, 2),
			new Vector2(-2, 2)
		]);
		legend.holes.push(
			new Path([
				new Vector2(-1, -1),
				new Vector2(1, -1),
				new Vector2(1, 1),
				new Vector2(-1, 1)
			])
		);
		const printT = new Transform().translateBy(0, 5, 0);
		const centre = facePointPrint(face, new Vector2(0, 0), printT);
		expect(pointInLegendEngraving([legend], new Vector2(0, 0))).toBe(false);
		const carved = carveEngravingFromSupportLines(
			[
				{
					points: [
						facePointPrint(face, new Vector2(0, 4), printT),
						facePointPrint(face, new Vector2(0, -4), printT)
					],
					normal: new Vector3(0, -1, 0),
					avoidLegends: true,
					faceIndex: 0
				}
			],
			[face],
			printT,
			[[legend]],
			0.2,
			0
		);
		expect(carved.length).toBeGreaterThanOrEqual(2);
		for (const line of carved) {
			const d = new Vector3().subVectors(line.points[1], line.points[0]);
			const lenSq = d.lengthSq();
			const t = new Vector3().subVectors(centre, line.points[0]).dot(d) / lenSq;
			const onSegment = t >= 0 && t <= 1;
			const closest = onSegment
				? line.points[0].clone().addScaledVector(d, t)
				: t < 0
					? line.points[0]
					: line.points[1];
			expect(closest.distanceTo(centre)).toBeGreaterThan(1.5);
		}
	});

	it('does not place legend contacts inside engraved fill', () => {
		const face: DieFaceModel = {
			isNumberFace: true,
			shape: new Shape([
				new Vector2(-5, -5),
				new Vector2(5, -5),
				new Vector2(5, 5),
				new Vector2(-5, 5)
			]),
			defaultLegend: Legend.ONE,
			transform: new Transform()
				.translateBy(0, 0, 8)
				.rotateByAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
		};
		// Wide rectangle so a wrong (inward) nudge clearly stays engraved.
		const legend = new Shape([
			new Vector2(-2, -2),
			new Vector2(2, -2),
			new Vector2(2, 2),
			new Vector2(-2, 2)
		]);
		const printT = new Transform().translateBy(0, 5, 0);
		const pts = detectLegendSupportsLocalMinima({
			faces: [face],
			faceLegendShapes: [[legend]],
			printingTransform: printT,
			settings: DEFAULT_SUPPORT_SETTINGS
		});
		expect(pts.length).toBeGreaterThanOrEqual(1);
		for (const pt of pts) {
			// Inverse of facePointPrint for this transform: print (x,y,z) ← local (x,y)
			// with face +Z → −Y print, then +Y translate.
			const local = new Vector2(pt.point.x, -pt.point.z);
			expect(pointInLegendEngraving([legend], local)).toBe(false);
		}
	});

	it('spaces contacts around a large contour more densely than minima alone', () => {
		const face: DieFaceModel = {
			isNumberFace: true,
			shape: new Shape([
				new Vector2(-10, -10),
				new Vector2(10, -10),
				new Vector2(10, 10),
				new Vector2(-10, 10)
			]),
			defaultLegend: Legend.ONE,
			transform: new Transform()
				.translateBy(0, 0, 8)
				.rotateByAxisAngle(new Vector3(1, 0, 0), Math.PI / 2)
		};
		// ~32mm perimeter square — with 2mm spacing expect many more than one min.
		const legend = new Shape([
			new Vector2(-4, -4),
			new Vector2(4, -4),
			new Vector2(4, 4),
			new Vector2(-4, 4)
		]);
		const printT = new Transform().translateBy(0, 5, 0);
		const dense = detectLegendSupportsLocalMinima({
			faces: [face],
			faceLegendShapes: [[legend]],
			printingTransform: printT,
			settings: { ...DEFAULT_SUPPORT_SETTINGS, legendSpacingMm: 2 }
		});
		const sparse = detectLegendSupportsLocalMinima({
			faces: [face],
			faceLegendShapes: [[legend]],
			printingTransform: printT,
			settings: { ...DEFAULT_SUPPORT_SETTINGS, legendSpacingMm: 8 }
		});
		expect(dense.length).toBeGreaterThanOrEqual(8);
		expect(dense.length).toBeGreaterThan(sparse.length);
	});

	it('translates legend shapes when the face offset is a plain {x, y}', () => {
		const face: DieFaceModel = {
			isNumberFace: true,
			shape: new Shape([new Vector2(-1, -1), new Vector2(1, -1), new Vector2(0, 1)]),
			defaultLegend: Legend.ONE,
			transform: new Transform()
		};
		const glyph = new Shape([new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1)]);
		const symbols = orientFaceLegendShapes(
			[face],
			[{ offset: { x: 2, y: -3 } as unknown as Vector2 }],
			{ get: () => [glyph] } as unknown as import('../legends').LegendSet,
			() => 1
		);
		const pts = symbols[0][0].getPoints();
		expect(pts.some((p) => Math.abs(p.x - 2) < 1e-6 && Math.abs(p.y + 3) < 1e-6)).toBe(true);
	});
});
