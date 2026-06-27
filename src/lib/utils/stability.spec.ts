import { describe, it, expect } from 'vitest';
import { dieCenterOfMass, dieHasLandWarning, restableNoRestFaces } from './stability';
import { CrystalD6 } from '../dice/crystals';
import { OddPrismD5 } from '../dice/odd_prism';
import { TruncatedTetrahedronD4 } from '../dice/truncated_tetrahedron';
import { TruncatedOctahedronD8 } from '../dice/truncated_octahedron';
import { CubeD6 } from '../dice/cube';

describe('dieCenterOfMass', () => {
	it('is at the origin for symmetric dice', () => {
		for (const model of [CrystalD6, OddPrismD5, TruncatedTetrahedronD4, TruncatedOctahedronD8]) {
			const com = dieCenterOfMass(model.build({}).faces);
			expect(com.length(), `${model.id} centre of mass`).toBeLessThan(1e-6);
		}
	});
});

describe('dieHasLandWarning', () => {
	it('never warns for a die with no no-rest faces (cube)', () => {
		const faces = CubeD6.build({}).faces;
		expect(faces.some((f) => f.noRest)).toBe(false);
		expect(dieHasLandWarning(faces)).toBe(false);
	});

	it('always warns for the truncated d4 (rests on a number triangle by design)', () => {
		expect(dieHasLandWarning(TruncatedTetrahedronD4.build({}).faces)).toBe(true);
	});

	it('warns for a truncated d8 only once it has square faces', () => {
		// no truncation => a plain octahedron with no squares, so nothing to warn on.
		expect(dieHasLandWarning(TruncatedOctahedronD8.build({ trunc_oct_truncation: 0 }).faces)).toBe(
			false
		);
		// the default truncation grows the (blank) squares enough to settle on.
		expect(dieHasLandWarning(TruncatedOctahedronD8.build({}).faces)).toBe(true);
	});

	it('warns for a crystal whose caps are flat enough to rest on', () => {
		// a tall, narrow crystal has steep cap facets the die rolls off of.
		const pointy = CrystalD6.build({ crystal_height: 40, crystal_width: 6, crystal_cap: 12 }).faces;
		expect(dieHasLandWarning(pointy)).toBe(false);
		// a squat, wide crystal with short caps presents near-flat cap facets it can
		// balance on, leaving a blank cap up.
		const flat = CrystalD6.build({ crystal_height: 6, crystal_width: 30, crystal_cap: 1 }).faces;
		expect(dieHasLandWarning(flat)).toBe(true);
	});

	it('flags only the cap faces of a crystal', () => {
		const faces = CrystalD6.build({ crystal_height: 6, crystal_width: 30, crystal_cap: 1 }).faces;
		for (const i of restableNoRestFaces(faces)) {
			expect(faces[i].isNumberFace).toBe(false);
			expect(faces[i].noRest).toBe(true);
		}
	});

	it('warns for an odd prism whose numbered ends are tall enough to rest on', () => {
		const tall = OddPrismD5.build({ prism_length: 8, prism_width: 30, prism_cap: 20 }).faces;
		expect(dieHasLandWarning(tall)).toBe(true);
	});
});
