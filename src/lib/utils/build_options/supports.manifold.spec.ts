import { describe, expect, it } from 'vitest';
import { Shape, type Vector3 } from 'three';
import { CubeD6 } from '$lib/dice/cube';
import type { Dice, DiceSet } from '$lib/interfaces/storage.svelte';
import tektur from '../../fonts/generated/tektur.json';
import { Builder } from '../builder';
import { buildExportMeshes, checkExportMesh, disposeNamedManifolds } from '../export';
import { loadImmutableLegends, type SerialisedLegendSet } from '../legends';
import { wasm, type Manifold } from '../manifold';
import {
	DEFAULT_SUPPORT_LAYER_VISIBILITY,
	DEFAULT_SUPPORT_SETTINGS,
	computeSupportRegions,
	orientFaceLegendShapes,
	sampleSupportContacts
} from '../supports';
import { blankOffsetMm, blanksOption, buildPrintBlank } from './blanks';
import { supportOptionValues, supportsOption } from './supports';
import { defaultValues } from './types';

const legends = loadImmutableLegends(tektur as unknown as SerialisedLegendSet);

function d6(): Dice {
	return {
		id: 'd6',
		kind: 'd6_cube',
		parameters: {},
		face_parameters: Array.from({ length: 6 }, () => ({}))
	};
}

function faceSpan(shape: Shape): number {
	const pts = shape.getPoints();
	let min = Infinity;
	let max = -Infinity;
	for (const p of pts) {
		min = Math.min(min, p.x);
		max = Math.max(max, p.x);
	}
	return max - min;
}

function probeVolume(man: Manifold, point: Vector3, radius: number): number {
	const probe = wasm.Manifold.sphere(radius, 8).translate([point.x, point.y, point.z]);
	const hit = wasm.Manifold.intersection(man, probe);
	const volume = hit.volume();
	hit.delete();
	probe.delete();
	return volume;
}

/** Fraction of a probe sphere that lies inside `man`. ~0.5 means the point is on the surface. */
function insideFraction(man: Manifold, point: Vector3, radius: number): number {
	const sphereVol = (4 / 3) * Math.PI * radius ** 3;
	return probeVolume(man, point, radius) / sphereVol;
}

describe('blank supports', () => {
	it('uses engraving depth plus tolerance, or a negative outset when bigger', () => {
		const die = d6();
		expect(blankOffsetMm(die, defaultValues(blanksOption.controls))).toBeCloseTo(1);
		expect(blankOffsetMm(die, { bigger: true, outset: 1.5, tolerance: 0.2 })).toBeCloseTo(-1.5);
	});

	it('places contacts on the resized blank and skips legends', () => {
		const die = d6();
		const builder = new Builder(CubeD6, legends, die.id);
		builder.useManifoldEngraving = false;
		builder.build(die.parameters, die.face_parameters, { explode: false });

		const blankValues = defaultValues(blanksOption.controls);
		const offset = blankOffsetMm(die, blankValues);
		const blank = buildPrintBlank(
			CubeD6,
			builder.getLastDieParams(),
			builder.getLastStringParams(),
			offset
		);
		blank.previewMesh.geometry.dispose();
		const previewMat = blank.previewMesh.material;
		if (!Array.isArray(previewMat)) previewMat.dispose();

		try {
			expect(faceSpan(blank.faces[0].shape)).toBeCloseTo(16);
			expect(faceSpan(builder.getFaces()[0].shape)).toBeCloseTo(18);

			const blankRegions = computeSupportRegions(
				blank.faces,
				blank.printingTransform,
				blank.faces.map(() => []),
				DEFAULT_SUPPORT_SETTINGS
			);
			expect(blankRegions.legendPoints).toHaveLength(0);

			const fullShapes = orientFaceLegendShapes(
				builder.getFaces(),
				die.face_parameters,
				legends,
				(legend) => builder.getDefaultScaleForLegend(legend)
			);
			const fullRegions = computeSupportRegions(
				builder.getFaces(),
				builder.getPrintingTransform(),
				fullShapes,
				DEFAULT_SUPPORT_SETTINGS
			);
			expect(fullRegions.legendPoints.length).toBeGreaterThan(0);

			const blankContacts = sampleSupportContacts(blankRegions, DEFAULT_SUPPORT_SETTINGS);
			expect(blankContacts.length).toBeGreaterThan(0);
			for (const contact of blankContacts) {
				const fraction = insideFraction(blank.manifold, contact.point, 0.4);
				expect(fraction, 'contact sits on the blank surface').toBeGreaterThan(0.05);
				expect(fraction, 'contact is not buried in the blank').toBeLessThan(0.9);
			}

			// The numbered die's edge contacts are placed on the full-size solid.
			// Most of them miss the shrunk blank entirely.
			const fullEdge = sampleSupportContacts(fullRegions, DEFAULT_SUPPORT_SETTINGS).filter(
				(c) => c.source === 'edge'
			);
			const missed = fullEdge.filter(
				(c) => insideFraction(blank.manifold, c.point, 0.3) < 0.05
			).length;
			expect(fullEdge.length).toBeGreaterThan(0);
			expect(missed).toBeGreaterThan(fullEdge.length * 0.5);
		} finally {
			blank.manifold.delete();
		}
	});

	it('unions the resized-blank supports into the exported blank', () => {
		const die = d6();
		const blankValues = defaultValues(blanksOption.controls);
		const supportValues = supportOptionValues({
			settings: { ...DEFAULT_SUPPORT_SETTINGS, edgeSpacingMm: 4, legendSpacingMm: 4 },
			layers: DEFAULT_SUPPORT_LAYER_VISIBILITY
		});
		const builder = new Builder(CubeD6, legends, die.id);
		builder.useManifoldEngraving = false;
		builder.build(die.parameters, die.face_parameters, { explode: false });
		const ctx = {
			die,
			model: CubeD6,
			builder,
			legends,
			values: supportValues,
			mergeTarget: 'blanks',
			optionValues: { blanks: blankValues }
		};

		const blank = buildPrintBlank(
			CubeD6,
			builder.getLastDieParams(),
			builder.getLastStringParams(),
			blankOffsetMm(die, blankValues)
		);
		blank.previewMesh.geometry.dispose();
		const previewMat = blank.previewMesh.material;
		if (!Array.isArray(previewMat)) previewMat.dispose();

		const supports = supportsOption.generate(ctx);
		expect(supports).toHaveLength(1);
		const supportManifold = supports[0].manifold;
		expect(supportManifold).toBeDefined();
		supports[0].mesh.geometry.dispose();

		const set = {
			id: 'test',
			name: 'test',
			updated: 0,
			legends,
			dice: [die]
		} as DiceSet;

		let named: ReturnType<typeof buildExportMeshes> | undefined;
		try {
			const blankVol = blank.manifold.volume();
			const supportVol = supportManifold!.volume();
			const union = wasm.Manifold.union([blank.manifold, supportManifold!]);
			const overlap = blankVol + supportVol - union.volume();
			union.delete();
			expect(supportVol).toBeGreaterThan(1);
			expect(overlap).toBeGreaterThan(0.01);

			named = buildExportMeshes(set, {
				includeDice: false,
				selectedIds: [die.id],
				optionStates: {
					blanks: { enabled: true, values: blankValues },
					supports: { enabled: true, values: supportValues }
				}
			});
			expect(named).toHaveLength(1);
			expect(named[0].group).toBe('blanks');
			const report = checkExportMesh(named[0]);
			expect(report.isPrintable, 'blank with supports').toBe(true);
			expect(Math.abs(named[0].manifold!.volume() - blankVol - supportVol + overlap)).toBeLessThan(
				1
			);
		} finally {
			blank.manifold.delete();
			supportManifold?.delete();
			if (named) disposeNamedManifolds(named);
			for (const n of named ?? []) n.mesh.geometry.dispose();
		}
	});
});
