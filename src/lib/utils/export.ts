import { Box3, Group, Mesh, Vector2, Vector3 } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { zipSync, type Zippable } from 'fflate';
import dice from '$lib/dice';
import type { DieFaceModel } from '$lib/interfaces/dice';
import type { Dice, DiceSet } from '$lib/interfaces/storage.svelte';
import { Builder } from './builder';
import { applyOrderingToFaces } from '$lib/utils/legend_orderings';
import { Legend, loadMutableLegends, type LegendSet, type SerialisedLegendSet } from './legends';
import { extraBuildOptions, type OptionValues } from './build_options';
import { blanks, isBuiltin, loadBuiltinById } from '$lib/fonts';
import { uuid } from './uuid';
import type { Manifold } from './manifold';
import { geometryToIndexedMesh, manifoldToIndexedMesh, type IndexedMesh } from './manifold';
import {
	checkIndexedMesh,
	checkMesh,
	type MeshCheckOptions,
	type MeshCheckReport
} from './mesh_check';
import { toNonIndexed } from './3d';
import {
	buildThreeMf,
	buildThreeMfGrouped,
	buildThreeMfGroupZip,
	buildThreeMfZip,
	type ThreeMfGroup,
	type ThreeMfObject,
	type UpAxis
} from './threemf';

export type ExportFormat = 'stl' | '3mf';

export type ThreeMfExportOptions = {
	// Pause before the print-in magnet bridge layer (mm, build-plate Z).
	magnetPauseZ?: number;
};

// `dieId` ties an exported mesh back to the die it came from (the main numbered
// die and any of its build-option artifacts all share the die's id), so callers
// like the mesh-health check can aggregate results per die. `group` identifies
// which export group the mesh belongs to ('dice' for the numbered die, otherwise
// the build option's id, e.g. 'blanks' / 'platforms') so callers can aggregate
// per group (e.g. volume totals). When present, `manifold` is the authoritative
// print solid; the mesh is for preview only.
export type NamedMesh = {
	name: string;
	mesh: Mesh;
	dieId?: string;
	group: string;
	manifold?: Manifold;
};

// Structural check for an export mesh. Prefers Manifold's indexed topology when
// present (no geometric weld — see checkIndexedMesh); falls back to welding the
// Three.js position buffer for legacy / preview-only geometry.
export function checkExportMesh(
	named: NamedMesh,
	options: Pick<MeshCheckOptions, 'collectBad'> = {}
): MeshCheckReport {
	if (named.manifold) {
		const { positions, indices } = manifoldToIndexedMesh(named.manifold);
		return checkIndexedMesh(positions, indices, options);
	}
	const pos = toNonIndexed(named.mesh.geometry).getAttribute('position');
	const array = pos.array as Float32Array;
	const tightlySized = array.length === pos.count * 3 ? array : array.subarray(0, pos.count * 3);
	return checkMesh(tightlySized, options);
}

// per-option UI state: whether it's enabled and the current values for its controls.
export type OptionState = { enabled: boolean; values: OptionValues };
export type OptionStates = Record<string, OptionState>;

export type BuildExportMeshesArgs = {
	// die ids to include; when omitted, all dice in the set are included.
	selectedIds?: Array<string>;
	// whether to include the actual numbered die mesh. set false to export only
	// the artifacts (e.g. just platforms). defaults to true.
	includeDice?: boolean;
	// per build-option state keyed by option id.
	optionStates?: OptionStates;
};

// Build the merged, print-ready mesh for every selected die plus any artifacts
// (blanks, platforms, ...) contributed by enabled build options.
export function buildExportMeshes(
	set: DiceSet,
	args: BuildExportMeshesArgs = {}
): Array<NamedMesh> {
	const optionStates = args.optionStates ?? {};
	const includeDice = args.includeDice ?? true;
	const out: Array<NamedMesh> = [];

	set.dice.forEach((die, idx) => {
		if (args.selectedIds && !args.selectedIds.includes(die.id)) {
			return;
		}
		out.push(...buildExportMeshesForDie(set, die, idx, { includeDice, optionStates }));
	});

	return out;
}

// Cache key for a single die's export meshes (main die + its enabled artifacts).
export function exportDieCacheSig(
	die: Dice,
	legendsId: string,
	includeDice: boolean,
	optionStates: OptionStates
): string {
	return JSON.stringify({
		kind: die.kind,
		parameters: die.parameters,
		face_parameters: die.face_parameters,
		string_parameters: die.string_parameters,
		legend_ordering: die.legend_ordering,
		legendsId,
		includeDice,
		optionStates
	});
}

// Build export meshes for one die. Geometries are at the die origin (not laid out).
export function buildExportMeshesForDie(
	set: DiceSet,
	die: Dice,
	idx: number,
	args: Pick<BuildExportMeshesArgs, 'includeDice' | 'optionStates'> & {
		builders?: Map<string, Builder>;
	} = {}
): Array<NamedMesh> {
	const optionStates = args.optionStates ?? {};
	const includeDice = args.includeDice ?? true;
	const out: Array<NamedMesh> = [];
	const model = dice[die.kind];
	const baseName = dieExportName(set, die.id, idx);

	let builder = args.builders?.get(die.id);
	if (!builder) {
		builder = new Builder(model, set.legends, die.id);
		args.builders?.set(die.id, builder);
	}

	if (includeDice) {
		const mainMesh = builder.export(
			die.parameters,
			die.face_parameters,
			die.string_parameters ?? {},
			die.legend_ordering
		);
		const mainManifold = builder.takeExportManifold();
		out.push({
			name: baseName,
			mesh: mainMesh,
			dieId: die.id,
			group: 'dice',
			manifold: mainManifold
		});
	}

	for (const option of extraBuildOptions) {
		const state = optionStates[option.id];
		if (!state?.enabled) {
			continue;
		}
		builder.build(
			die.parameters,
			die.face_parameters,
			{ explode: false, ordering: die.legend_ordering },
			die.string_parameters ?? {}
		);
		const artifacts = option.generate({
			die,
			model,
			builder,
			legends: set.legends,
			values: state.values
		});
		for (const artifact of artifacts) {
			out.push({
				name: `${baseName}_${artifact.suffix}`,
				mesh: artifact.mesh,
				dieId: die.id,
				group: option.id,
				manifold: artifact.manifold
			});
		}
	}

	return out;
}

function dieExportName(set: DiceSet, dieId: string, idx: number): string {
	const die = set.dice.find((d) => d.id === dieId);
	const kind = die ? die.kind : 'die';
	return `${idx + 1}_${kind}`;
}

// Arrange meshes in a roughly-square grid using X/Z translations only (Y is left
// untouched so every die stays on the same level). Mutates the meshes'
// geometries in place. Used for the on-screen preview and the all-in-one file.
//
// When the list spans multiple export groups (dice / blanks / platforms / ...),
// each group is laid out as its own congruent section — same item order and the
// same (col, row) slots — then sections are stacked along Z with `gap` between
// them. Within a single group the behaviour is the simple uniform grid.
export function layoutGrid(meshes: Array<Mesh>, gap = 4): void {
	layoutNamedMeshes(
		meshes.map((mesh) => ({ name: '', mesh, group: '' })),
		gap
	);
}

export function layoutNamedMeshes(named: Array<NamedMesh>, gap = 4): void {
	if (named.length === 0) {
		return;
	}

	const sections = partitionNamedByGroup(named);
	const maxN = Math.max(...sections.map((s) => s.length));
	const cols = Math.ceil(Math.sqrt(maxN));
	const rows = Math.ceil(maxN / cols);

	for (const section of sections) {
		layoutNamedMeshesInGrid(section, cols, rows, gap);
	}

	if (sections.length === 1) {
		return;
	}

	// Stack sections along +Z, then re-centre the whole assembly on the origin
	// so the preview / single-file export still sits mid-bed.
	let cursorZ = 0;
	const overall = new Box3();
	for (const section of sections) {
		const box = namedMeshesBounds(section);
		const dz = cursorZ - box.min.z;
		translateNamedMeshes(section, 0, dz);
		box.min.z += dz;
		box.max.z += dz;
		overall.union(box);
		cursorZ = box.max.z + gap;
	}

	const center = new Vector3();
	overall.getCenter(center);
	if (center.x !== 0 || center.z !== 0) {
		translateNamedMeshes(named, -center.x, -center.z);
	}
}

// Partition preserving first-appearance order of `group` (typically dice, then
// blanks, then platforms — matching build/export order).
function partitionNamedByGroup(named: Array<NamedMesh>): Array<Array<NamedMesh>> {
	const order: Array<string> = [];
	const byGroup = new Map<string, Array<NamedMesh>>();
	for (const n of named) {
		let bucket = byGroup.get(n.group);
		if (!bucket) {
			bucket = [];
			byGroup.set(n.group, bucket);
			order.push(n.group);
		}
		bucket.push(n);
	}
	return order.map((g) => byGroup.get(g)!);
}

function layoutNamedMeshesInGrid(
	named: Array<NamedMesh>,
	cols: number,
	rows: number,
	gap: number
): void {
	const n = named.length;
	if (n === 0) {
		return;
	}

	const footprints = named.map((entry) => {
		entry.mesh.geometry.computeBoundingBox();
		const box = entry.mesh.geometry.boundingBox ?? new Box3();
		const size = new Vector3();
		box.getSize(size);
		const center = new Vector3();
		box.getCenter(center);
		return { size, center };
	});

	let cellW = 0;
	let cellD = 0;
	for (const f of footprints) {
		cellW = Math.max(cellW, f.size.x);
		cellD = Math.max(cellD, f.size.z);
	}
	cellW += gap;
	cellD += gap;

	named.forEach((entry, i) => {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const x = (col - (cols - 1) / 2) * cellW;
		const z = (row - (rows - 1) / 2) * cellD;
		const f = footprints[i];
		const dx = x - f.center.x;
		const dz = z - f.center.z;
		entry.mesh.geometry.translate(dx, 0, dz);
		entry.manifold?.translate(dx, 0, dz);
	});
}

function namedMeshesBounds(named: Array<NamedMesh>): Box3 {
	const box = new Box3();
	for (const n of named) {
		n.mesh.geometry.computeBoundingBox();
		if (n.mesh.geometry.boundingBox) {
			box.union(n.mesh.geometry.boundingBox);
		}
	}
	return box;
}

function translateNamedMeshes(named: Array<NamedMesh>, dx: number, dz: number): void {
	if (dx === 0 && dz === 0) {
		return;
	}
	for (const entry of named) {
		entry.mesh.geometry.translate(dx, 0, dz);
		entry.manifold?.translate(dx, 0, dz);
	}
}

// --- STL -------------------------------------------------------------------

const _exporter = new STLExporter();

function vertexForExport(
	x: number,
	y: number,
	z: number,
	upAxis: UpAxis
): [number, number, number] {
	// Match the 3MF writer: dice are Y-up, print bed is Z-up.
	if (upAxis === 'y') {
		return [x, -z, y];
	}
	return [x, y, z];
}

// Expand an indexed Manifold mesh into the flat 9-floats-per-triangle buffer
// mesh_check uses. Applies the same up-axis rotation as 3MF export.
export function indexedMeshToFlatPositions(mesh: IndexedMesh, upAxis: UpAxis = 'y'): Float32Array {
	const { positions, indices } = mesh;
	const out = new Float32Array(indices.length * 3);
	let o = 0;
	for (let i = 0; i < indices.length; i++) {
		const vi = indices[i];
		const [x, y, z] = vertexForExport(
			positions[vi * 3],
			positions[vi * 3 + 1],
			positions[vi * 3 + 2],
			upAxis
		);
		out[o++] = x;
		out[o++] = y;
		out[o++] = z;
	}
	return out;
}

export function manifoldToFlatPositions(man: Manifold, upAxis: UpAxis = 'y'): Float32Array {
	return indexedMeshToFlatPositions(manifoldToIndexedMesh(man), upAxis);
}

function stlBinary(object: Mesh | Group): Uint8Array {
	const data = _exporter.parse(object, { binary: true }) as unknown as DataView;
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function stlBinaryOfMeshes(meshes: Array<Mesh>): Uint8Array {
	const group = new Group();
	for (const m of meshes) {
		group.add(m);
	}
	return stlBinary(group);
}

// All meshes combined into a single STL (they should already be laid out).
export function exportStlSingle(meshes: Array<Mesh>): Blob {
	return new Blob([stlBinaryOfMeshes(meshes) as BlobPart], { type: 'model/stl' });
}

// One STL per group, packed into a single ZIP: each group's meshes are merged
// into one combined STL (the group's meshes should already be laid out).
export function exportStlGroupZip(groups: Array<ThreeMfMeshGroup>): Blob {
	const files: Zippable = {};
	const used = new Set<string>();
	for (const g of groups) {
		let filename = `${g.name}.stl`;
		let i = 1;
		while (used.has(filename)) {
			filename = `${g.name}_${i++}.stl`;
		}
		used.add(filename);
		files[filename] = stlBinaryOfMeshes(g.meshes.map((n) => n.mesh));
	}
	const zipped = zipSync(files);
	return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

// One STL per mesh, packed into a single ZIP.
export function exportStlZip(named: Array<NamedMesh>): Blob {
	const files: Zippable = {};
	const used = new Set<string>();
	for (const { name, mesh } of named) {
		let filename = `${name}.stl`;
		let i = 1;
		while (used.has(filename)) {
			filename = `${name}_${i++}.stl`;
		}
		used.add(filename);
		files[filename] = stlBinary(mesh);
	}
	const zipped = zipSync(files);
	return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

// --- 3MF -------------------------------------------------------------------

// Convert the named meshes into indexed 3MF objects. Uses the live Manifold
// solid when present; otherwise falls back to geometryToIndexedMesh.
function toThreeMfObject(named: NamedMesh, used: Set<string>): ThreeMfObject {
	let uniqueName = named.name;
	let i = 1;
	while (used.has(uniqueName)) {
		uniqueName = `${named.name}_${i++}`;
	}
	used.add(uniqueName);
	if (named.manifold) {
		return { name: uniqueName, ...manifoldToIndexedMesh(named.manifold) };
	}
	const { positions, indices } = geometryToIndexedMesh(named.mesh.geometry);
	return { name: uniqueName, positions, indices };
}

export function disposeNamedManifolds(named: Array<NamedMesh>): void {
	for (const entry of named) {
		entry.manifold?.delete();
		entry.manifold = undefined;
	}
}

function toThreeMfObjects(named: Array<NamedMesh>): Array<ThreeMfObject> {
	const used = new Set<string>();
	return named.map((n) => toThreeMfObject(n, used));
}

// All meshes combined into a single .3mf (each die/artifact is its own object in
// one build). The meshes should already be laid out, mirroring exportStlSingle.
// `upAxis` is the source frame's up axis ('y' for dice, 'z' for boxes).
export async function exportThreeMfSingle(
	named: Array<NamedMesh>,
	upAxis: UpAxis = 'y',
	options?: ThreeMfExportOptions
): Promise<Blob> {
	return buildThreeMf(toThreeMfObjects(named), upAxis, options?.magnetPauseZ);
}

// Export an existing Manifold solid directly to 3MF (no Three.js round-trip).
export async function exportThreeMfFromManifold(
	name: string,
	man: Manifold,
	upAxis: UpAxis = 'y',
	options?: ThreeMfExportOptions
): Promise<Blob> {
	return buildThreeMf([{ name, ...manifoldToIndexedMesh(man) }], upAxis, options?.magnetPauseZ);
}

// A set of meshes that should export as one grouped 3MF object.
export type ThreeMfMeshGroup = { name: string; meshes: Array<NamedMesh> };

// Partition named meshes into one grouped-object spec per export group ('dice',
// 'blanks', 'platforms', ...), preserving first-appearance order. Each category
// becomes a single grouped 3MF object named `${prefix}_${group}`, so a slicer
// sees e.g. all numbered dice as one object, all blanks as another, etc.
export function groupMeshesByCategory(
	named: Array<NamedMesh>,
	prefix: string
): Array<ThreeMfMeshGroup> {
	const order: Array<string> = [];
	const byGroup = new Map<string, Array<NamedMesh>>();
	for (const n of named) {
		let bucket = byGroup.get(n.group);
		if (!bucket) {
			bucket = [];
			byGroup.set(n.group, bucket);
			order.push(n.group);
		}
		bucket.push(n);
	}
	return order.map((g) => ({ name: `${prefix}_${g}`, meshes: byGroup.get(g)! }));
}

// All meshes combined into a single .3mf, but each group becomes ONE grouped
// object (a 3MF component object) rather than independent build items. The
// meshes should already be laid out. `upAxis` is the source frame's up axis.
export async function exportThreeMfGrouped(
	groups: Array<ThreeMfMeshGroup>,
	upAxis: UpAxis = 'y',
	options?: ThreeMfExportOptions
): Promise<Blob> {
	const used = new Set<string>();
	const tmGroups: Array<ThreeMfGroup> = groups.map((g) => ({
		name: g.name,
		objects: g.meshes.map((n) => toThreeMfObject(n, used))
	}));
	return buildThreeMfGrouped(tmGroups, upAxis, options?.magnetPauseZ);
}

// One .3mf per group, packed into a ZIP. Each file holds the group's meshes as a
// single grouped object (the meshes should already be laid out per group).
export async function exportThreeMfGroupZip(
	groups: Array<ThreeMfMeshGroup>,
	upAxis: UpAxis = 'y',
	options?: ThreeMfExportOptions
): Promise<Blob> {
	const used = new Set<string>();
	const tmGroups: Array<ThreeMfGroup> = groups.map((g) => ({
		name: g.name,
		objects: g.meshes.map((n) => toThreeMfObject(n, used))
	}));
	return buildThreeMfGroupZip(tmGroups, upAxis, options?.magnetPauseZ);
}

// One .3mf per mesh, packed into a single ZIP (mirrors exportStlZip).
export async function exportThreeMfZip(
	named: Array<NamedMesh>,
	upAxis: UpAxis = 'y',
	options?: ThreeMfExportOptions
): Promise<Blob> {
	return buildThreeMfZip(toThreeMfObjects(named), upAxis, options?.magnetPauseZ);
}

// --- JSON ------------------------------------------------------------------

// 'all' embeds the entire legend set, 'used' only the slots the dice reference,
// 'reference' embeds no shapes at all (just the id/name) — for built-in sets the
// importer recovers the shapes from the bundle, so shipping them is wasted bytes
// (notably in a share URL).
export type EmbedLegends = 'all' | 'used' | 'reference';

// Serialize a set to a self-contained JSON string, embedding either the entire
// legend set or only the legends actually referenced by the dice.
// Strip editor-only metadata (revision, source font, per-slot recipes) so an
// exported file only carries the legends themselves.
function stripLegendsForExport(s: SerialisedLegendSet): SerialisedLegendSet {
	return { id: s.id, name: s.name, shapes: s.shapes };
}

// Serialize a single legend set to JSON, containing only the legend shapes and
// names (no source font / editor metadata).
export function exportLegendSetJson(legends: LegendSet): string {
	return JSON.stringify(stripLegendsForExport(legends.toJSON()));
}

export function exportSetJson(set: DiceSet, opts: { embedLegends: EmbedLegends }): string {
	let legends: SerialisedLegendSet;
	if (opts.embedLegends === 'all') {
		legends = stripLegendsForExport(set.legends.toJSON());
	} else if (opts.embedLegends === 'reference') {
		legends = { id: set.legends.id, name: set.legends.name, shapes: [] };
	} else {
		legends = reduceLegends(set, set.legends);
	}

	const payload = {
		version: 1,
		set: {
			id: set.id,
			name: set.name,
			updated: set.updated,
			dice: set.dice
		},
		legends
	};

	return JSON.stringify(payload, (_key, value) => {
		if (value instanceof Vector2) {
			return { _: 'v2', x: value.x, y: value.y };
		}
		return value;
	});
}

// Revive the compact Vector2 markers produced by exportSetJson back into real
// Vector2 instances.
function importReviver(_key: string, value: any) {
	if (value && typeof value === 'object' && value._ === 'v2') {
		return new Vector2(value.x, value.y);
	}
	return value;
}

// Parse a JSON string previously produced by exportSetJson back into a DiceSet.
// A fresh set id and fresh die ids are assigned so importing never clobbers an
// existing saved set, mirroring how presets create brand-new sets.
export async function importSetJson(json: string): Promise<DiceSet> {
	let payload: any;
	try {
		payload = JSON.parse(json, importReviver);
	} catch {
		throw new Error('The file is not valid JSON.');
	}

	const set = payload?.set;
	if (!set || !Array.isArray(set.dice)) {
		throw new Error('This does not look like an exported set.');
	}

	const legends = await resolveImportedLegends(payload.legends);

	return {
		id: uuid(),
		name: typeof set.name === 'string' && set.name ? set.name : 'Imported set',
		updated: Date.now(),
		dice: (set.dice as Array<Dice>).map((die) => ({ ...die, id: uuid() })),
		legends
	};
}

// Resolve the legend set referenced by an imported file: prefer the matching
// built-in font when the id is built-in, otherwise rebuild the embedded
// (custom) legends so they get persisted alongside the set.
async function resolveImportedLegends(
	legends: SerialisedLegendSet | undefined
): Promise<LegendSet> {
	if (!legends || !legends.id) {
		return blanks;
	}
	if (isBuiltin(legends.id)) {
		return loadBuiltinById(legends.id);
	}
	return loadMutableLegends(legends);
}

// Build a SerialisedLegendSet containing only the legends used by the set's
// dice (defaults + per-face overrides), keeping array indices aligned with the
// Legend enum so it round-trips through the loaders.
function reduceLegends(set: DiceSet, legends: LegendSet): SerialisedLegendSet {
	const full = legends.toJSON();
	const used = collectUsedLegends(set);

	const maxIdx = Math.max(0, ...Array.from(used).filter((l) => l >= 0));
	const shapes: Array<Array<any>> = [];
	for (let l = 0; l <= maxIdx; l++) {
		shapes[l] = used.has(l) && l in full.shapes ? full.shapes[l] : [];
	}

	return { id: full.id, name: full.name, shapes };
}

function collectUsedLegends(set: DiceSet): Set<Legend> {
	const used = new Set<Legend>();
	for (const die of set.dice) {
		const model = dice[die.kind];
		let faces: Array<DieFaceModel>;
		try {
			faces = model.build(die.parameters, die.string_parameters ?? {}).faces;
			// the chosen ordering rewrites the number faces' default legends, so
			// apply it before collecting which legends the die actually uses.
			applyOrderingToFaces(die.kind, die.legend_ordering, faces, die.parameters);
		} catch {
			faces = [];
		}
		faces.forEach((face, i) => {
			const legend = die.face_parameters[i]?.legend ?? face.defaultLegend;
			if (legend !== undefined && legend !== Legend.BLANK) {
				used.add(legend);
			}
		});
	}
	return used;
}

// --- download --------------------------------------------------------------

export function download(blob: Blob, filename: string): void {
	const link = document.createElement('a');
	link.download = filename;
	link.href = URL.createObjectURL(blob);
	link.style.display = 'none';
	document.body.appendChild(link);
	link.click();
	setTimeout(() => {
		URL.revokeObjectURL(link.href);
		link.remove();
	});
}
