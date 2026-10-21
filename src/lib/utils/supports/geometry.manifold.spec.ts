import { describe, expect, it } from 'vitest';
import { DOMParser } from 'xmldom';
import { Vector3 } from 'three';
import { CoinD2 } from '$lib/dice/coin';
import { assembleBlankExportShellGeometry, transformToMat4 } from '../die_manifold';
import { checkIndexedMesh } from '../mesh_check';
import { geometryToManifold, manifoldToIndexedMesh, wasm } from '../manifold';
import { computeEdgeSupportLines } from './regions';
import {
	buildSingleSupportManifold,
	buildSupportsManifold,
	pillarMiterOverhangMm,
	placeSupportFoot,
	sampleSupportContacts
} from './geometry';
import { DEFAULT_SUPPORT_SETTINGS, type SupportRegions } from './types';

describe('support geometry', () => {
	it('unions a handful of contacts + hexagonal raft pads into a watertight manifold', () => {
		const regions: SupportRegions = {
			edgeLines: [
				{
					points: [new Vector3(0, 8, 0), new Vector3(6, 8, 0)],
					normal: new Vector3(0, -1, 0)
				},
				{
					points: [new Vector3(0, 5, 3), new Vector3(0, 8, 3)],
					normal: new Vector3(-1, 0, 0)
				}
			],
			legendPoints: [{ point: new Vector3(2, 6, -2), normal: new Vector3(0, -1, 0) }]
		};
		const built = buildSupportsManifold(regions, DEFAULT_SUPPORT_SETTINGS, undefined);
		expect(built).toBeDefined();
		expect(built!.contactCount).toBeGreaterThanOrEqual(2);
		const { positions, indices } = manifoldToIndexedMesh(built!.manifold);
		const report = checkIndexedMesh(positions, indices);
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		expect(report.degenerateTriangleCount).toBe(0);
		built!.manifold.delete();
		built!.mesh.geometry.dispose();
	});

	it('always angles the foot outward so the cone tips toward the die', () => {
		const contact = new Vector3(0, 12, 0);
		const normal = new Vector3(1, 0, 0); // outward +X
		const foot = placeSupportFoot(
			contact,
			normal,
			DEFAULT_SUPPORT_SETTINGS,
			undefined,
			{ x: 0, z: 0 }
		);
		// Foot should sit outward along +X, not under the contact.
		expect(foot.footX).toBeGreaterThan(0.3);
		expect(Math.abs(foot.footZ)).toBeLessThan(0.05);
	});

	it('leans further when a vertical column hits the die', () => {
		const blocker = wasm.Manifold.cube([8, 10, 8], false).translate([-4, 2, -4]);
		const contact = new Vector3(0, 12, 0);
		const normal = new Vector3(1, 0, 0);
		const foot = placeSupportFoot(
			contact,
			normal,
			DEFAULT_SUPPORT_SETTINGS,
			blocker,
			{ x: 0, z: 0 }
		);
		expect(foot.footX).toBeGreaterThan(1);
		blocker.delete();
	});

	it('builds a single support solid that is manifold (mitered lean)', () => {
		const foot = {
			contact: new Vector3(1, 8, 1),
			footX: 2.5,
			footZ: 1,
			coneBaseY: 6.5
		};
		const man = buildSingleSupportManifold(foot, DEFAULT_SUPPORT_SETTINGS);
		const { positions, indices } = manifoldToIndexedMesh(man);
		const report = checkIndexedMesh(positions, indices);
		expect(report.isWatertight).toBe(true);
		expect(report.isManifold).toBe(true);
		// The joint ball is centred here and contains this probe. A gap between the
		// pillar and the angled stub would leave the centre uncovered.
		const elbow = wasm.Manifold.sphere(0.12, 8).translate([
			foot.footX,
			foot.coneBaseY,
			foot.footZ
		]);
		const inside = wasm.Manifold.intersection(man, elbow);
		expect(inside.volume()).toBeGreaterThan(elbow.volume() * 0.8);
		inside.delete();
		elbow.delete();
		man.delete();
	});

	it('computes a positive miter overhang for a leaning cone', () => {
		const dir = new Vector3(0.5, 0.866, 0).normalize(); // ~30° from vertical
		const overhang = pillarMiterOverhangMm(dir, 0.5);
		expect(overhang).toBeGreaterThan(0.2);
	});

	it('keeps contacts on both sides of a sharp edge (inset pair)', () => {
		// Two inset runs of the same edge, 1.2 mm apart (2×0.6 inset) with
		// opposing face normals — must both survive spacing dedupe.
		const regions: SupportRegions = {
			edgeLines: [
				{
					points: [new Vector3(0, 2, 0), new Vector3(0, 8, 0)],
					normal: new Vector3(1, 0, 0)
				},
				{
					points: [new Vector3(1.2, 2, 0), new Vector3(1.2, 8, 0)],
					normal: new Vector3(-1, 0, 0)
				}
			],
			legendPoints: []
		};
		const contacts = sampleSupportContacts(regions, {
			...DEFAULT_SUPPORT_SETTINGS,
			edgeSpacingMm: 3,
			edgeInsetMm: 0.6
		});
		const sideA = contacts.filter((c) => c.normal.x > 0.5);
		const sideB = contacts.filter((c) => c.normal.x < -0.5);
		expect(sideA.length).toBeGreaterThanOrEqual(2);
		expect(sideB.length).toBeGreaterThanOrEqual(2);
	});

	it('samples edge lines with spacing and always includes the lower end', () => {
		const regions: SupportRegions = {
			edgeLines: [
				{
					points: [new Vector3(0, 2, 0), new Vector3(0, 11, 0)],
					normal: new Vector3(1, 0, 0)
				}
			],
			legendPoints: []
		};
		const contacts = sampleSupportContacts(regions, {
			...DEFAULT_SUPPORT_SETTINGS,
			edgeSpacingMm: 3
		});
		expect(contacts.length).toBeGreaterThanOrEqual(3);
		expect(contacts.some((c) => Math.abs(c.point.y - 2) < 1e-6)).toBe(true);
	});

	it('turns a foot whose face normal points into the die', () => {
		// Contact on the x=0 face, but the normal points into the box the way a
		// concave notch's wall points at the opposite lobe.
		const blocker = wasm.Manifold.cube([10, 10, 10], false).translate([0, 0, -5]);
		const contact = new Vector3(0, 8, 0);
		const foot = placeSupportFoot(
			contact,
			new Vector3(1, 0, 0),
			DEFAULT_SUPPORT_SETTINGS,
			blocker,
			{ x: 5, z: 0 }
		);
		// Outside the box, and not merely grazing the face.
		expect(foot.footX).toBeLessThan(-0.4);
		const support = buildSingleSupportManifold(foot, DEFAULT_SUPPORT_SETTINGS);
		const tipR = DEFAULT_SUPPORT_SETTINGS.sphereDiameterMm / 2;
		const carve = wasm.Manifold.sphere(tipR * 1.5, 10).translate([contact.x, contact.y, contact.z]);
		const body = wasm.Manifold.difference(support, carve);
		support.delete();
		carve.delete();
		const hit = wasm.Manifold.intersection(blocker, body);
		body.delete();
		expect(hit.volume()).toBeLessThan(0.05);
		hit.delete();
		blocker.delete();
	});

	it('keeps custom-coin supports out of the concave outline', () => {
		(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
		const path = CoinD2.stringParameters?.find((p) => p.id === 'coin_path')?.defaultValue ?? '';
		const coin = CoinD2.build({ coin_shape_mode: 1 }, { coin_path: path });
		const shell = assembleBlankExportShellGeometry(coin.faces);
		const die = geometryToManifold(shell).transform(transformToMat4(coin.printingTransform!));
		shell.dispose();
		const lines = computeEdgeSupportLines(
			coin.faces,
			coin.printingTransform!,
			DEFAULT_SUPPORT_SETTINGS
		);
		const contacts = sampleSupportContacts(
			{ edgeLines: lines, legendPoints: [] },
			DEFAULT_SUPPORT_SETTINGS
		);
		let cx = 0;
		let cz = 0;
		for (const c of contacts) {
			cx += c.point.x;
			cz += c.point.z;
		}
		cx /= contacts.length;
		cz /= contacts.length;
		const tipR = DEFAULT_SUPPORT_SETTINGS.sphereDiameterMm / 2;
		let worst = 0;
		for (const c of contacts) {
			const foot = placeSupportFoot(c.point, c.normal, DEFAULT_SUPPORT_SETTINGS, die, {
				x: cx,
				z: cz
			});
			const support = buildSingleSupportManifold(foot, DEFAULT_SUPPORT_SETTINGS);
			const carve = wasm.Manifold.sphere(tipR * 1.5, 10).translate([
				c.point.x,
				c.point.y,
				c.point.z
			]);
			const body = wasm.Manifold.difference(support, carve);
			support.delete();
			carve.delete();
			const hit = wasm.Manifold.intersection(die, body);
			body.delete();
			worst = Math.max(worst, hit.volume());
			hit.delete();
		}
		expect(contacts.length).toBeGreaterThan(20);
		expect(worst).toBeLessThan(0.02);
		let floating = 0;
		for (const c of contacts) {
			const probe = wasm.Manifold.sphere(0.15, 8).translate([c.point.x, c.point.y, c.point.z]);
			const touch = wasm.Manifold.intersection(die, probe);
			probe.delete();
			if (touch.volume() < 1e-6) floating++;
			touch.delete();
		}
		expect(floating).toBe(0);
		die.delete();
	});
});
