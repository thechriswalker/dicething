import { blanksOption } from './blanks';
import { platformsOption } from './platforms';
import { supportsOption } from './supports';
import type { ExtraBuildOption } from './types';

// Ordered registry of extra build options surfaced in the export flow. To add a
// new exportable artifact, implement ExtraBuildOption in its own file and add it
// here; the export page and export.ts pick it up automatically.
export const extraBuildOptions: Array<ExtraBuildOption> = [
	blanksOption,
	platformsOption,
	supportsOption
];

export type { ExtraBuildOption } from './types';
export { controlValue, defaultValues, isControlVisible, isMergeOption } from './types';
export type { OptionControl, OptionValues, ExtraBuildContext, BuildArtifact } from './types';
