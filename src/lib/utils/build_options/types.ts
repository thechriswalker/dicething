import type { Mesh } from 'three';
import type { Builder } from '../builder';
import type { DieModel } from '$lib/interfaces/dice';
import type { LegendSet } from '../legends';
import type { Dice } from '$lib/interfaces/storage.svelte';

// A single declarative control an extra build option exposes in the export UI.
// Kept intentionally small/self-describing so the export page can render any
// option generically without knowing what it is.
type ControlBase = {
	id: string;
	label: string;
	// optional helper text shown under the control.
	help?: string;
	// only show this control when another control currently has this value.
	visibleWhen?: { control: string; equals: number | boolean };
};

export type NumberControl = ControlBase & {
	kind: 'number';
	min: number;
	max: number;
	step: number;
	default: number;
	unit?: string;
};

export type BoolControl = ControlBase & {
	kind: 'bool';
	default: boolean;
};

export type OptionControl = NumberControl | BoolControl;

export type OptionValues = Record<string, number | boolean>;

export type ExtraBuildContext = {
	die: Dice; // kind + parameters + face_parameters
	model: DieModel;
	builder: Builder; // already built for this die; exposes getFaces(), getFace2FaceDistance()
	legends: LegendSet;
	values: OptionValues; // values for THIS option's controls (see `controls`)
};

// One artifact produced for a single die. `suffix` is appended to the die's
// export name, e.g. "die-3_blank", "die-3_platform".
export type BuildArtifact = { suffix: string; mesh: Mesh };

// An extra build option that plugs into the export flow. Implement this + add it
// to the registry in `index.ts` to surface a new kind of exportable artifact.
export type ExtraBuildOption = {
	id: string; // stable id, used as a key in the UI
	label: string;
	description?: string;
	defaultEnabled?: boolean;
	controls: Array<OptionControl>;
	// produce zero or more extra meshes for one die. an empty array means this
	// option contributes nothing for the given die.
	generate(ctx: ExtraBuildContext): Array<BuildArtifact>;
};

// Helper: resolve a control's value from a values bag, falling back to default.
export function controlValue(controls: Array<OptionControl>, values: OptionValues, id: string) {
	const control = controls.find((c) => c.id === id);
	const v = values[id];
	if (v !== undefined) {
		return v;
	}
	return control?.default;
}

// Build the default values bag for an option's controls.
export function defaultValues(controls: Array<OptionControl>): OptionValues {
	const out: OptionValues = {};
	for (const c of controls) {
		out[c.id] = c.default;
	}
	return out;
}

// Whether a control should be shown given the current values (respects its
// `visibleWhen` dependency).
export function isControlVisible(control: OptionControl, values: OptionValues): boolean {
	const cond = control.visibleWhen;
	if (!cond) {
		return true;
	}
	return values[cond.control] === cond.equals;
}
