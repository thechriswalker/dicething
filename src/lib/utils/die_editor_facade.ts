// UI-facing facade mirroring the Builder methods DiceParameters needs, backed
// by die-engine build metadata from the worker.
import type { DieFaceModel } from '$lib/interfaces/dice';
import type { DieBuildMetadata, DieFaceSnapshot } from './die_engine_protocol';
import { Legend } from './legends';

function snapshotToFace(s: DieFaceSnapshot): Pick<DieFaceModel, 'defaultLegend' | 'isNumberFace' | 'hidden' | 'convex'> {
	return {
		defaultLegend: s.defaultLegend as Legend,
		isNumberFace: s.isNumberFace,
		hidden: s.hidden,
		convex: s.convex
	};
}

export class DieEditorFacade {
	constructor(private meta: DieBuildMetadata) {}

	update(meta: DieBuildMetadata) {
		this.meta = meta;
	}

	getFaces(): Array<Pick<DieFaceModel, 'defaultLegend' | 'isNumberFace' | 'hidden' | 'convex'>> {
		return this.meta.faces.map(snapshotToFace);
	}

	getDefaultScaleForLegend(l: Legend): number {
		if (this.meta.individualLegendScaling) {
			return this.meta.legendScaling[l] ?? this.meta.smallestLegendScaling;
		}
		return this.meta.smallestLegendScaling;
	}

	getApproximateVolume(): number {
		return this.meta.approximateVolume;
	}

	getFace2FaceDistance(): number {
		return this.meta.face2FaceDistance;
	}

	getEngravingErrors() {
		return this.meta.engravingErrors;
	}
}
