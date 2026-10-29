import { m } from '$lib/paraglide/messages';
import type { Shape } from 'three';
import {
	assembleBlankExportShellGeometry,
	getOrBuildBlankManifold,
	transformToMat4
} from '../die_manifold';
import {
	buildSupportsManifold,
	computeSupportRegions,
	DEFAULT_SUPPORT_LAYER_VISIBILITY,
	DEFAULT_SUPPORT_SETTINGS,
	filterSupportRegions,
	mergeSupportSettings,
	orientFaceLegendShapes,
	SupportCancelledError,
	type SupportConfig,
	type SupportLayerVisibility,
	type SupportSettings
} from '../supports';
import { blankOffsetMm, buildPrintBlank } from './blanks';
import { type ExtraBuildContext, type ExtraBuildOption, type OptionValues } from './types';

function finiteNumber(v: number | boolean | undefined, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function finiteBool(v: number | boolean | undefined, fallback: boolean): boolean {
	return typeof v === 'boolean' ? v : fallback;
}

/** Flat control bag for one resolved support config, used as the export option values. */
export function supportOptionValues(config: SupportConfig): OptionValues {
	return {
		layerEdges: config.layers.edges,
		layerLegends: config.layers.legends,
		layerTipPost: config.layers.tipPost,
		...config.settings
	};
}

export function supportSettingsFromValues(values: OptionValues): SupportSettings {
	const D = DEFAULT_SUPPORT_SETTINGS;
	return mergeSupportSettings({
		pillarDiameterMm: finiteNumber(values.pillarDiameterMm, D.pillarDiameterMm),
		coneLengthMm: finiteNumber(values.coneLengthMm, D.coneLengthMm),
		sphereDiameterMm: finiteNumber(values.sphereDiameterMm, D.sphereDiameterMm),
		raftDepthMm: finiteNumber(values.raftDepthMm, D.raftDepthMm),
		raftSizeMm: finiteNumber(values.raftSizeMm, D.raftSizeMm),
		edgeInsetMm: finiteNumber(values.edgeInsetMm, D.edgeInsetMm),
		edgeSpacingMm: finiteNumber(values.edgeSpacingMm, D.edgeSpacingMm),
		legendSpacingMm: finiteNumber(values.legendSpacingMm, D.legendSpacingMm),
		faceMinAngleDeg: finiteNumber(values.faceMinAngleDeg, D.faceMinAngleDeg),
		maxHeadLeanDeg: finiteNumber(values.maxHeadLeanDeg, D.maxHeadLeanDeg),
		postDiameterMm: finiteNumber(values.postDiameterMm, D.postDiameterMm),
		postFinThicknessMm: finiteNumber(values.postFinThicknessMm, D.postFinThicknessMm)
	});
}

export function supportLayersFromValues(values: OptionValues): SupportLayerVisibility {
	const V = DEFAULT_SUPPORT_LAYER_VISIBILITY;
	return {
		edges: finiteBool(values.layerEdges, V.edges),
		legends: finiteBool(values.layerLegends, V.legends),
		tipPost: finiteBool(values.layerTipPost, V.tipPost)
	};
}

export const supportsOption: ExtraBuildOption = {
	id: 'supports',
	label: m.export_opt_supports_label,
	description: m.export_opt_supports_description,
	defaultEnabled: false,
	// Union into the printable die / blank — not a separate support body.
	// Sizes and layers are configured per die / per set in the dice builder.
	mergeInto: ['dice', 'blanks'],
	controls: [],
	generate(ctx) {
		try {
			// Blanks are a different solid: resized, and with no engraving. Supports
			// built for the numbered die miss that surface and chase legends that
			// were never cut.
			if (ctx.mergeTarget === 'blanks') {
				return generateBlankSupports(ctx);
			}
			return generateDieSupports(ctx);
		} catch (e) {
			if (e instanceof SupportCancelledError) {
				return [];
			}
			throw e;
		}
	}
};

function generateBlankSupports(ctx: ExtraBuildContext) {
	const settings = supportSettingsFromValues(ctx.values);
	const layers = supportLayersFromValues(ctx.values);
	if (!layers.edges && !layers.tipPost) {
		return [];
	}
	const blank = buildPrintBlank(
		ctx.model,
		ctx.builder.getLastDieParams(),
		ctx.builder.getLastStringParams(),
		blankOffsetMm(ctx.die, ctx.optionValues?.blanks ?? {})
	);
	const cancel = { cancelled: false };
	const checkCancel = () => {
		if (ctx.isCancelled?.()) {
			cancel.cancelled = true;
		}
	};
	const faceShapes: Array<Array<Shape>> = blank.faces.map(() => []);

	try {
		blank.previewMesh.geometry.dispose();
		const material = blank.previewMesh.material;
		if (Array.isArray(material)) {
			for (const mat of material) mat.dispose();
		} else {
			material.dispose();
		}
		const regions = filterSupportRegions(
			computeSupportRegions(blank.faces, blank.printingTransform, faceShapes, settings, {
				cancel,
				onProgress: (phase, frac, label) => {
					checkCancel();
					ctx.onProgress?.(phase, frac, label);
				}
			}),
			{ ...layers, legends: false }
		);
		checkCancel();
		if (cancel.cancelled) {
			throw new SupportCancelledError();
		}
		const built = buildSupportsManifold(regions, settings, blank.manifold, {
			cancel,
			onProgress: (phase, frac, label) => {
				checkCancel();
				ctx.onProgress?.(phase, frac, label);
			}
		});
		if (!built) {
			return [];
		}
		return [{ suffix: 'supports', mesh: built.mesh, manifold: built.manifold }];
	} finally {
		blank.manifold.delete();
	}
}

function generateDieSupports(ctx: ExtraBuildContext) {
	const settings = supportSettingsFromValues(ctx.values);
	const layers = supportLayersFromValues(ctx.values);
	if (!layers.edges && !layers.legends && !layers.tipPost) {
		return [];
	}
	const faces = ctx.builder.getFaces();
	const printT = ctx.builder.getPrintingTransform();
	const faceShapes = orientFaceLegendShapes(faces, ctx.die.face_parameters, ctx.legends, (l) =>
		ctx.builder.getDefaultScaleForLegend(l)
	);

	const cancel = { cancelled: false };
	const checkCancel = () => {
		if (ctx.isCancelled?.()) {
			cancel.cancelled = true;
		}
	};

	const regions = filterSupportRegions(
		computeSupportRegions(faces, printT, faceShapes, settings, {
			cancel,
			onProgress: (phase, frac, label) => {
				checkCancel();
				ctx.onProgress?.(phase, frac, label);
			}
		}),
		layers
	);
	checkCancel();
	if (cancel.cancelled) {
		throw new SupportCancelledError();
	}

	// Print-oriented blank for lean probes (borrowed blank × print transform).
	const params = ctx.builder.getLastDieParams();
	const stringParams = ctx.builder.getLastStringParams();
	const shell = assembleBlankExportShellGeometry([...faces]);
	const blank = getOrBuildBlankManifold(ctx.model.id, [...faces], params, stringParams, {
		source: 'export',
		exportGeometry: shell
	});
	shell.dispose();
	const printMat = transformToMat4(printT);
	const diePrint = blank.manifold.transform(printMat);

	try {
		const built = buildSupportsManifold(regions, settings, diePrint, {
			cancel,
			onProgress: (phase, frac, label) => {
				checkCancel();
				ctx.onProgress?.(phase, frac, label);
			}
		});
		if (!built) {
			return [];
		}
		return [{ suffix: 'supports', mesh: built.mesh, manifold: built.manifold }];
	} finally {
		diePrint.delete();
	}
}
