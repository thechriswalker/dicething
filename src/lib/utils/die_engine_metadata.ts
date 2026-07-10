import type { Builder } from './builder';
import type { DieBuildMetadata, DieFaceSnapshot } from './die_engine_protocol';

export function metadataFromBuilder(builder: Builder, dieId: string, generation: number): DieBuildMetadata {
	const faces: Array<DieFaceSnapshot> = builder.getFaces().map((f, index) => ({
		index,
		defaultLegend: f.defaultLegend,
		isNumberFace: !!f.isNumberFace,
		hidden: !!f.hidden,
		convex: f.convex !== false
	}));
	const legendScaling: Record<number, number> = {};
	for (const [legend, scale] of builder.currentLegendScaling) {
		legendScaling[legend] = scale;
	}
	return {
		dieId,
		generation,
		faces,
		approximateVolume: builder.getApproximateVolume(),
		face2FaceDistance: builder.getFace2FaceDistance(),
		individualLegendScaling: builder.getIndividualLegendScaling(),
		smallestLegendScaling: builder.currentSmallestLegendScaling,
		legendScaling,
		engravingErrors: builder.getEngravingErrors()
	};
}
