import { describe, expect, it } from 'vitest';
import { Vector2, Vector3 } from 'three';
import { CaltropCustomD4 } from '../dice/caltrop';
import { CoinD2 } from '../dice/coin';
import { CubeD6 } from '../dice/cube';
import { IcosahedronD20 } from '../dice/icosahedron';
import type { DieFaceModel } from '$lib/interfaces/dice';
import { Transform } from './3d';
import {
	PRINT_CLEARANCE_MM,
	computeOutlineVertexDownPrintingTransform,
	computePointDownPrintingTransform
} from './printing';
import { Shape } from 'three';
import { Legend } from './legends';

function minYAfterPrint(faces: ReturnType<typeof CubeD6.build>['faces']): number {
	const t = computePointDownPrintingTransform(faces);
	let minY = Infinity;
	for (const face of faces) {
		for (const p of face.shape.getPoints(8)) {
			const v = face.transform.applyToVector3(new Vector3(p.x, p.y, 0));
			t.applyToVector3(v);
			minY = Math.min(minY, v.y);
		}
	}
	return minY;
}

describe('computePointDownPrintingTransform', () => {
	it(`lifts dice so the lowest point is ~${PRINT_CLEARANCE_MM}mm above the plate`, () => {
		for (const model of [CaltropCustomD4, CubeD6, IcosahedronD20]) {
			const { faces } = model.build({});
			expect(minYAfterPrint(faces), model.id).toBeCloseTo(PRINT_CLEARANCE_MM, 2);
		}
	});

	it('points a tetrahedron vertex straight down', () => {
		const { faces } = CaltropCustomD4.build({});
		const t = computePointDownPrintingTransform(faces);
		const tips: Array<Vector3> = [];
		const seen = new Set<string>();
		const centroid = new Vector3();
		for (const face of faces) {
			for (const p of face.shape.getPoints(4)) {
				const v = face.transform.applyToVector3(new Vector3(p.x, p.y, 0));
				t.applyToVector3(v);
				const key = `${v.x.toFixed(3)}:${v.y.toFixed(3)}:${v.z.toFixed(3)}`;
				if (!seen.has(key)) {
					seen.add(key);
					tips.push(v);
					centroid.add(v);
				}
			}
		}
		centroid.multiplyScalar(1 / tips.length);
		tips.sort((a, b) => a.y - b.y);
		const tip = tips[0];
		expect(tip.y).toBeCloseTo(PRINT_CLEARANCE_MM, 2);
		const down = tip.clone().sub(centroid).normalize();
		expect(down.y).toBeLessThan(-0.99);
	});
});

describe('computeOutlineVertexDownPrintingTransform', () => {
	it('stands a square outline on a corner, not an edge', () => {
		const outline = [
			new Vector2(0.5, 0.5),
			new Vector2(0.5, -0.5),
			new Vector2(-0.5, -0.5),
			new Vector2(-0.5, 0.5)
		];
		const shape = new Shape(outline.map((p) => p.clone()));
		const faces: Array<DieFaceModel> = [
			{
				isNumberFace: true,
				shape,
				defaultLegend: Legend.BLANK,
				transform: new Transform()
			}
		];
		const t = computeOutlineVertexDownPrintingTransform(outline, faces, PRINT_CLEARANCE_MM);
		const corners = outline.map((p) => {
			const v = new Vector3(p.x, p.y, 0);
			t.applyToVector3(v);
			return v;
		});
		corners.sort((a, b) => a.y - b.y);
		expect(corners[0].y).toBeCloseTo(PRINT_CLEARANCE_MM, 5);
		// a true corner: only one vertex at the minimum (edge-down would share min Y).
		expect(corners[1].y - corners[0].y).toBeGreaterThan(0.1);
		expect(Math.abs(corners[0].x)).toBeLessThan(1e-6);
	});

	it('orients the square coin onto a vertex', () => {
		const built = CoinD2.build({ coin_segments: 4, coin_diameter: 20, coin_bevel_amount: 0 });
		const t = built.printingTransform!;
		const samples = built.faces[0].shape.getPoints(32).map((p) => {
			const v = built.faces[0].transform.applyToVector3(new Vector3(p.x, p.y, 0));
			t.applyToVector3(v);
			return v;
		});
		expect(samples.length).toBeGreaterThan(3);
		samples.sort((a, b) => a.y - b.y);
		expect(samples[0].y).toBeCloseTo(PRINT_CLEARANCE_MM, 1);
		// vertex-down: the second-lowest distinct corner is well above the tip
		// (edge-down would leave a whole flat run at the same min Y).
		const next = samples.find((p) => p.y > samples[0].y + 0.05)!;
		expect(next.y - samples[0].y).toBeGreaterThan(0.5);
	});
});
