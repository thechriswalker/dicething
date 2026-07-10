import { describe, it, expect } from 'vitest';
import { cloneManifold, manifoldToGeometry, toFlatPositions } from './manifold';
import { buildBlankManifold, buildBlankManifoldFromGeometry, engraveDie, extractFaceGeometry } from './die_manifold';
import { Part } from './engraving';
import { checkMesh } from './mesh_check';
import { Builder } from './builder';
import dice from '$lib/dice';
import fonts from '$lib/fonts';
import { Legend } from './legends';
import { findBestLegendScalingFactor } from './shapes';

describe('die_manifold engraving', () => {
	function scaledFaceParams(
		faces: ReturnType<(typeof dice)['d6_cube']['build']>['faces'],
		legends: Awaited<ReturnType<(typeof fonts)['voltaire']['load']>>,
		tolerance = 0.5
	) {
		return faces.map((face) => {
			if (face.hidden) {
				return { legend: Legend.BLANK };
			}
			const legend = face.defaultLegend;
			const scale = findBestLegendScalingFactor(
				face.shape,
				legends.get(legend),
				tolerance,
				face.convex !== false
			);
			return { legend, scale };
		});
	}

	it('d6 prism blank is watertight and manifold', async () => {
		const built = dice.d6_cube.build({ polyhedron_size: 18 });
		const blank = buildBlankManifold(built.faces);
		expect(blank.manifold.status()).toBe('NoError');
		const report = checkMesh(toFlatPositions(manifoldToGeometry(blank.manifold)));
		blank.manifold.delete();
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
	});

	it('d6 export-shell blank engraves one pip and stays printable', async () => {
		const legends = await fonts.voltaire.load();
		const params = { polyhedron_size: 18, engraving_depth: 1, engraving_tolerance: 0.5 };
		const built = dice.d6_cube.build(params);
		const builder = new Builder(dice.d6_cube, legends);
		const blankMesh = builder.export(
			params,
			built.faces.map(() => ({ legend: Legend.BLANK }))
		);
		const blank = buildBlankManifoldFromGeometry(blankMesh.geometry, built.faces);
		const faceParams = scaledFaceParams(built.faces, legends);
		const engraved = engraveDie(blank, {
			faces: built.faces,
			legends,
			faceParams,
			depth: 1,
			tolerance: 0.5
		});
		const report = checkMesh(toFlatPositions(manifoldToGeometry(engraved)));
		blank.manifold.delete();
		engraved.delete();
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		expect(report.degenerateTriangleCount).toBe(0);
		expect(report.isPrintable).toBe(true);
	});

	it('tagged export-shell blank extracts Front cap per face', async () => {
		const legends = await fonts.voltaire.load();
		const params = { polyhedron_size: 18, engraving_depth: 1, engraving_tolerance: 0.5 };
		const built = dice.d6_cube.build(params);
		const builder = new Builder(dice.d6_cube, legends);
		const blankMesh = builder.export(
			params,
			built.faces.map(() => ({ legend: Legend.BLANK }))
		);
		const blank = buildBlankManifoldFromGeometry(blankMesh.geometry, built.faces);
		for (let i = 0; i < built.faces.length; i++) {
			if (built.faces[i].hidden) {
				continue;
			}
			const engraved = cloneManifold(blank.manifold);
			const parts = extractFaceGeometry(engraved, built.faces[i], i, 1);
			engraved.delete();
			expect(parts.some((p) => p.userData.diceThingPart === Part.Front), `face ${i} Front`).toBe(
				true
			);
		}
		blank.manifold.delete();
	});

	it('d20 with all legends subtract stays printable via export blank', async () => {
		const legends = await fonts.voltaire.load();
		const params = { polyhedron_size: 18, engraving_depth: 1, engraving_tolerance: 0.5 };
		const built = dice.d20_icosahedron.build(params);
		const builder = new Builder(dice.d20_icosahedron, legends);
		const blankMesh = builder.export(
			params,
			built.faces.map(() => ({ legend: Legend.BLANK }))
		);
		const blank = buildBlankManifoldFromGeometry(blankMesh.geometry, built.faces);
		const faceParams = scaledFaceParams(built.faces, legends);
		const engraved = engraveDie(blank, {
			faces: built.faces,
			legends,
			faceParams,
			depth: 1,
			tolerance: 0.5
		});
		const report = checkMesh(toFlatPositions(manifoldToGeometry(engraved)));
		blank.manifold.delete();
		engraved.delete();
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		expect(report.degenerateTriangleCount).toBe(0);
		expect(report.isPrintable).toBe(true);
	});

	it('d2 coin with hidden rim faces stays printable', async () => {
		const legends = await fonts.voltaire.load();
		const params = {
			coin_diameter: 24,
			coin_thickness: 3,
			coin_segments: 24,
			engraving_depth: 1,
			engraving_tolerance: 0.5
		};
		const built = dice.d2_coin.build(params);
		const builder = new Builder(dice.d2_coin, legends);
		const blankMesh = builder.export(
			params,
			built.faces.map(() => ({ legend: Legend.BLANK }))
		);
		const blank = buildBlankManifoldFromGeometry(blankMesh.geometry, built.faces);
		const faceParams = scaledFaceParams(built.faces, legends);
		const engraved = engraveDie(blank, {
			faces: built.faces,
			legends,
			faceParams,
			depth: 1,
			tolerance: 0.5
		});
		const report = checkMesh(toFlatPositions(manifoldToGeometry(engraved)));
		blank.manifold.delete();
		engraved.delete();
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		expect(report.degenerateTriangleCount).toBe(0);
		expect(report.isPrintable).toBe(true);
	});
});
