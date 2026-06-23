import { blanksOption } from './blanks';
import { platformsOption } from './platforms';
import type { ExtraBuildOption } from './types';

// Ordered registry of extra build options surfaced in the export flow. To add a
// new exportable artifact, implement ExtraBuildOption in its own file and add it
// here; the export page and export.ts pick it up automatically.
export const extraBuildOptions: Array<ExtraBuildOption> = [blanksOption, platformsOption];

export type { ExtraBuildOption } from './types';
export { controlValue, defaultValues, isControlVisible } from './types';
export type { OptionControl, OptionValues, ExtraBuildContext, BuildArtifact } from './types';
