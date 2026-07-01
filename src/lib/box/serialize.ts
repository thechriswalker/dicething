// Serialisation helpers for moving box build results across the worker
// boundary. The builders (`buildBox`, `prepareLayout`) return live three.js
// objects (BufferGeometry, Vector2/Vector3) which cannot survive a structured
// clone with their prototypes intact, so we flatten them to plain typed-array
// buffers + {x,y,z} records here, transfer the buffers (zero-copy), and rebuild
// the three objects on the far side.
//
// Normals are intentionally NOT carried: manifoldToGeometry recomputes flat-ish
// vertex normals anyway, so the rehydrate side just calls computeVertexNormals()
// (cheap relative to the CSG that produced the geometry).

import { BufferAttribute, BufferGeometry, Float32BufferAttribute, Vector2, Vector3 } from 'three';
import type { BuiltBox, PlacedDie, BoxBoundaries, LayoutDie, PreparedLayout } from './box_builder';

export type SerialisedGeometry = {
	position: Float32Array;
	// undefined when the source geometry is non-indexed.
	index?: Uint32Array;
};

type SerialisedVec2 = { x: number; y: number };
type SerialisedVec3 = { x: number; y: number; z: number };

type SerialisedPlacedDie = {
	dieId: string;
	half: PlacedDie['half'];
	geometry: SerialisedGeometry;
};

type SerialisedBoundaries = {
	dice: Array<Array<SerialisedVec2>>;
	combined: Array<SerialisedVec2>;
	inner: Array<SerialisedVec2>;
};

export type SerialisedBuiltBox = {
	base: SerialisedGeometry;
	lid: SerialisedGeometry;
	placedDice: Array<SerialisedPlacedDie>;
	outer: SerialisedVec2;
	baseHeight: number;
	lidHeight: number;
	boundaries: SerialisedBoundaries;
	// plain-data hinge metadata (no three.js objects), passes through untouched.
	hinge?: BuiltBox['hinge'];
	closure: BuiltBox['closure'];
};

type SerialisedLayoutDie = {
	dieId: string;
	kind: string;
	hull0: Array<SerialisedVec2>;
	size: SerialisedVec3;
	autoPos: SerialisedVec2;
	include: boolean;
};

export type SerialisedPreparedLayout = {
	dice: Array<SerialisedLayoutDie>;
	box: { halfX: number; halfY: number };
};

function vec2(v: Vector2): SerialisedVec2 {
	return { x: v.x, y: v.y };
}

function vec3(v: Vector3): SerialisedVec3 {
	return { x: v.x, y: v.y, z: v.z };
}

function geometryToBuffers(geo: BufferGeometry): SerialisedGeometry {
	const pos = geo.getAttribute('position');
	// copy into a fresh Float32Array so we own a transferable buffer (and don't
	// detach the source geometry, which the main thread may still render).
	const position = Float32Array.from(pos.array as ArrayLike<number>);
	const idx = geo.index;
	const index = idx ? Uint32Array.from(idx.array as ArrayLike<number>) : undefined;
	return { position, index };
}

function buffersToGeometry(s: SerialisedGeometry): BufferGeometry {
	const geo = new BufferGeometry();
	geo.setAttribute('position', new Float32BufferAttribute(s.position, 3));
	if (s.index) {
		geo.setIndex(new BufferAttribute(s.index, 1));
	}
	geo.computeVertexNormals();
	return geo;
}

export function serializeBuiltBox(box: BuiltBox): SerialisedBuiltBox {
	return {
		base: geometryToBuffers(box.base),
		lid: geometryToBuffers(box.lid),
		placedDice: box.placedDice.map((d) => ({
			dieId: d.dieId,
			half: d.half,
			geometry: geometryToBuffers(d.geometry)
		})),
		outer: vec2(box.outer),
		baseHeight: box.baseHeight,
		lidHeight: box.lidHeight,
		boundaries: {
			dice: box.boundaries.dice.map((poly) => poly.map(vec2)),
			combined: box.boundaries.combined.map(vec2),
			inner: box.boundaries.inner.map(vec2)
		},
		hinge: box.hinge,
		closure: box.closure
	};
}

export function rehydrateBuiltBox(s: SerialisedBuiltBox): BuiltBox {
	const boundaries: BoxBoundaries = {
		dice: s.boundaries.dice.map((poly) => poly.map((p) => new Vector2(p.x, p.y))),
		combined: s.boundaries.combined.map((p) => new Vector2(p.x, p.y)),
		inner: s.boundaries.inner.map((p) => new Vector2(p.x, p.y))
	};
	return {
		base: buffersToGeometry(s.base),
		lid: buffersToGeometry(s.lid),
		placedDice: s.placedDice.map((d) => ({
			dieId: d.dieId,
			half: d.half,
			geometry: buffersToGeometry(d.geometry)
		})),
		outer: new Vector2(s.outer.x, s.outer.y),
		baseHeight: s.baseHeight,
		lidHeight: s.lidHeight,
		boundaries,
		hinge: s.hinge,
		closure: s.closure
	};
}

export function serializePreparedLayout(layout: PreparedLayout): SerialisedPreparedLayout {
	return {
		dice: layout.dice.map((d) => ({
			dieId: d.dieId,
			kind: d.kind,
			hull0: d.hull0.map(vec2),
			size: vec3(d.size),
			autoPos: vec2(d.autoPos),
			include: d.include
		})),
		box: { halfX: layout.box.halfX, halfY: layout.box.halfY }
	};
}

export function rehydratePreparedLayout(s: SerialisedPreparedLayout): PreparedLayout {
	const dice: Array<LayoutDie> = s.dice.map((d) => ({
		dieId: d.dieId,
		kind: d.kind,
		hull0: d.hull0.map((p) => new Vector2(p.x, p.y)),
		size: new Vector3(d.size.x, d.size.y, d.size.z),
		autoPos: new Vector2(d.autoPos.x, d.autoPos.y),
		include: d.include
	}));
	return { dice, box: { halfX: s.box.halfX, halfY: s.box.halfY } };
}

// Collect every transferable ArrayBuffer in a serialised box so postMessage can
// move them zero-copy instead of cloning.
export function builtBoxTransferables(s: SerialisedBuiltBox): Array<ArrayBuffer> {
	const out: Array<ArrayBuffer> = [];
	const push = (g: SerialisedGeometry) => {
		// the typed arrays here are always backed by a plain ArrayBuffer (we built
		// them with Float32Array/Uint32Array.from), never a SharedArrayBuffer.
		out.push(g.position.buffer as ArrayBuffer);
		if (g.index) {
			out.push(g.index.buffer as ArrayBuffer);
		}
	};
	push(s.base);
	push(s.lid);
	for (const d of s.placedDice) {
		push(d.geometry);
	}
	return out;
}
