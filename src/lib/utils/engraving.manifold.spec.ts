import { describe, it, expect } from 'vitest';
import { BufferGeometry, Shape, Vector2, Vector3 } from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import tektur from '../fonts/generated/tektur.json';
import alice from '../fonts/generated/alice_in_wonderland.json';
import averia from '../fonts/generated/averia.json';
import germania from '../fonts/generated/germania_one.json';
import josefin from '../fonts/generated/josefin_medium.json';
import siamese from '../fonts/generated/siamese_katsong.json';
import voltaire from '../fonts/generated/voltaire.json';
import { shapeFromJSON } from './to_json';
import { engrave } from './engraving';
import { centerShapes } from './shapes';
import { removeDuplicateTriangles } from './bad_edges';

const H = 20;

function makeSurface(): Shape {
	return new Shape([
		new Vector2(-H, -H),
		new Vector2(H, -H),
		new Vector2(H, H),
		new Vector2(-H, H)
	]);
}

function onPerimeter(x: number, y: number): boolean {
	const e = 1e-3;
	return Math.abs(Math.abs(x) - H) < e || Math.abs(Math.abs(y) - H) < e;
}

function key(v: Vector3): string {
	return [v.x.toFixed(5), v.y.toFixed(5), v.z.toFixed(5)].join(',');
}

// Count edges shared by != 2 triangles, ignoring the outer surface perimeter
// (which is legitimately open here because there is no die body in the test).
function countNonManifoldEdges(geo: BufferGeometry): number {
	const pos = geo.toNonIndexed().getAttribute('position').array;
	const edges = new Map<string, { a: Vector3; b: Vector3; count: number }>();
	const a = new Vector3();
	const b = new Vector3();
	const c = new Vector3();
	const addEdge = (p: Vector3, q: Vector3) => {
		const pk = key(p);
		const qk = key(q);
		const id = pk < qk ? pk + '|' + qk : qk + '|' + pk;
		let e = edges.get(id);
		if (!e) {
			e = { a: p.clone(), b: q.clone(), count: 0 };
			edges.set(id, e);
		}
		e.count++;
	};
	for (let i = 0; i < pos.length; i += 9) {
		a.set(pos[i], pos[i + 1], pos[i + 2]);
		b.set(pos[i + 3], pos[i + 4], pos[i + 5]);
		c.set(pos[i + 6], pos[i + 7], pos[i + 8]);
		addEdge(a, b);
		addEdge(b, c);
		addEdge(c, a);
	}
	return [...edges.values()].filter(
		(e) => e.count !== 2 && !(onPerimeter(e.a.x, e.a.y) && onPerimeter(e.b.x, e.b.y))
	).length;
}

function engraveMerged(symbols: Shape[]): BufferGeometry {
	const parts = engrave(makeSurface(), symbols, {}, 1, 0.5, 24);
	const prepared = parts.map((g) => {
		const ng = g.toNonIndexed();
		ng.computeVertexNormals();
		delete ng.attributes.uv;
		delete ng.attributes.normal;
		return ng;
	});
	return removeDuplicateTriangles(mergeVertices(mergeGeometries(prepared)));
}

function loadGlyph(font: any, index: number): Shape[] {
	const shapes = font.shapes[index].map((s: any) => shapeFromJSON(s)) as Shape[];
	return centerShapes(...shapes);
}

const allFonts: Array<[string, any]> = [
	['tektur', tektur],
	['alice_in_wonderland', alice],
	['averia', averia],
	['germania_one', germania],
	['josefin_medium', josefin],
	['siamese_katsong', siamese],
	['voltaire', voltaire]
];

describe('engraving is manifold', () => {
	it('tektur 0 (regression: hole vertex collinear with outer edge)', () => {
		expect(countNonManifoldEdges(engraveMerged(loadGlyph(tektur, 0)))).toBe(0);
	});

	it('every symbol of every builtin font engraves to a manifold mesh', () => {
		const failures: string[] = [];
		for (const [name, font] of allFonts) {
			for (let i = 0; i < font.shapes.length; i++) {
				if (!font.shapes[i] || font.shapes[i].length === 0) {
					continue; // blank / missing
				}
				const bad = countNonManifoldEdges(engraveMerged(loadGlyph(font, i)));
				if (bad !== 0) {
					failures.push(`${name}[${i}]: ${bad} non-manifold edges`);
				}
			}
		}
		expect(failures).toEqual([]);
	});
});
