import { Box3, Group, Mesh, Vector2, Vector3 } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { zipSync, type Zippable } from 'fflate';
import dice from '$lib/dice';
import type { DieFaceModel } from '$lib/interfaces/dice';
import type { Dice, DiceSet } from '$lib/interfaces/storage.svelte';
import { Builder } from './builder';
import {
	Legend,
	loadMutableLegends,
	type LegendSet,
	type SerialisedLegendSet
} from './legends';
import { extraBuildOptions, type OptionValues } from './build_options';
import { blanks, isBuiltin, loadBuiltinById } from '$lib/fonts';
import { uuid } from './uuid';

export type ExportFormat = 'stl' | '3mf';

// `dieId` ties an exported mesh back to the die it came from (the main numbered
// die and any of its build-option artifacts all share the die's id), so callers
// like the mesh-health check can aggregate results per die.
export type NamedMesh = { name: string; mesh: Mesh; dieId?: string };

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
export function buildExportMeshes(set: DiceSet, args: BuildExportMeshesArgs = {}): Array<NamedMesh> {
	const optionStates = args.optionStates ?? {};
	const includeDice = args.includeDice ?? true;
	const out: Array<NamedMesh> = [];

	set.dice.forEach((die, idx) => {
		if (args.selectedIds && !args.selectedIds.includes(die.id)) {
			return;
		}
		const model = dice[die.kind];
		const baseName = dieExportName(set, die.id, idx);

		// the main numbered die (optional).
		if (includeDice) {
			const mainBuilder = new Builder(model, set.legends, die.id);
			const mainMesh = mainBuilder.export(
				die.parameters,
				die.face_parameters,
				die.string_parameters ?? {}
			);
			out.push({ name: baseName, mesh: mainMesh, dieId: die.id });
		}

		// extra artifacts. each option gets its own fully-built builder so that
		// re-exporting (e.g. blanks) can't corrupt another option's read of the
		// die's faces.
		for (const option of extraBuildOptions) {
			const state = optionStates[option.id];
			if (!state?.enabled) {
				continue;
			}
			const builder = new Builder(model, set.legends, die.id);
			builder.build(
				die.parameters,
				die.face_parameters,
				{ explode: false },
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
				out.push({ name: `${baseName}_${artifact.suffix}`, mesh: artifact.mesh, dieId: die.id });
			}
		}
	});

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
export function layoutGrid(meshes: Array<Mesh>, gap = 4): void {
	const n = meshes.length;
	if (n === 0) {
		return;
	}
	const cols = Math.ceil(Math.sqrt(n));
	const rows = Math.ceil(n / cols);

	const footprints = meshes.map((m) => {
		m.geometry.computeBoundingBox();
		const box = m.geometry.boundingBox ?? new Box3();
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

	meshes.forEach((mesh, i) => {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const x = (col - (cols - 1) / 2) * cellW;
		const z = (row - (rows - 1) / 2) * cellD;
		// center the die over its cell in X/Z, leave Y as-is.
		const f = footprints[i];
		mesh.geometry.translate(x - f.center.x, 0, z - f.center.z);
	});
}

// --- STL -------------------------------------------------------------------

const _exporter = new STLExporter();

function stlBinary(object: Mesh | Group): Uint8Array {
	const data = _exporter.parse(object, { binary: true }) as unknown as DataView;
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

// All meshes combined into a single STL (they should already be laid out).
export function exportStlSingle(meshes: Array<Mesh>): Blob {
	const group = new Group();
	for (const m of meshes) {
		group.add(m);
	}
	return new Blob([stlBinary(group) as BlobPart], { type: 'model/stl' });
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

// --- JSON ------------------------------------------------------------------

export type EmbedLegends = 'all' | 'used';

// Serialize a set to a self-contained JSON string, embedding either the entire
// legend set or only the legends actually referenced by the dice.
// Strip editor-only metadata (revision, source font, per-slot recipes) so an
// exported file only carries the legends themselves.
function stripLegendsForExport(s: SerialisedLegendSet): SerialisedLegendSet {
	return { id: s.id, name: s.name, names: s.names, shapes: s.shapes };
}

// Serialize a single legend set to JSON, containing only the legend shapes and
// names (no source font / editor metadata).
export function exportLegendSetJson(legends: LegendSet): string {
	return JSON.stringify(stripLegendsForExport(legends.toJSON()));
}

export function exportSetJson(set: DiceSet, opts: { embedLegends: EmbedLegends }): string {
	const legends =
		opts.embedLegends === 'all'
			? stripLegendsForExport(set.legends.toJSON())
			: reduceLegends(set, set.legends);

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
async function resolveImportedLegends(legends: SerialisedLegendSet | undefined): Promise<LegendSet> {
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
	const names: Array<string> = [];
	for (let l = 0; l <= maxIdx; l++) {
		if (used.has(l) && l in full.shapes) {
			shapes[l] = full.shapes[l];
			names[l] = full.names[l] ?? '';
		} else {
			shapes[l] = [];
			names[l] = '';
		}
	}

	return { id: full.id, name: full.name, names, shapes };
}

function collectUsedLegends(set: DiceSet): Set<Legend> {
	const used = new Set<Legend>();
	for (const die of set.dice) {
		const model = dice[die.kind];
		let faces: Array<DieFaceModel>;
		try {
			faces = model.build(die.parameters, die.string_parameters ?? {}).faces;
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
