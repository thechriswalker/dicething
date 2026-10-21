import { m } from '$lib/paraglide/messages';
import {
	assembleBlankExportShellGeometry,
	getOrBuildBlankManifold,
	transformToMat4
} from '../die_manifold';
import {
	buildSupportsManifold,
	computeSupportRegions,
	filterSupportRegions,
	mergeSupportSettings,
	orientFaceLegendShapes,
	SupportCancelledError,
	SUPPORT_SETTING_LIMITS,
	type SupportLayerVisibility,
	type SupportSettings
} from '../supports';
import { controlValue, type ExtraBuildContext, type ExtraBuildOption, type OptionValues } from './types';

const L = SUPPORT_SETTING_LIMITS;

const controls: ExtraBuildOption['controls'] = [
	{
		id: 'layerEdges',
		kind: 'bool',
		label: m.supports_layer_edges,
		default: true,
		help: m.supports_layer_edges_help
	},
	{
		id: 'layerLegends',
		kind: 'bool',
		label: m.supports_layer_legends,
		default: true,
		help: m.supports_layer_legends_help
	},
	{
		id: 'layerTipPost',
		kind: 'bool',
		label: m.supports_layer_tip_post,
		default: true,
		help: m.supports_layer_tip_post_help
	},
	{
		id: 'pillarDiameterMm',
		kind: 'number',
		label: m.export_opt_supports_pillar_label,
		min: L.pillarDiameterMm.min,
		max: L.pillarDiameterMm.max,
		step: L.pillarDiameterMm.step,
		default: 0.45,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_pillar_help
	},
	{
		id: 'coneLengthMm',
		kind: 'number',
		label: m.export_opt_supports_cone_label,
		min: L.coneLengthMm.min,
		max: L.coneLengthMm.max,
		step: L.coneLengthMm.step,
		default: 3,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_cone_help
	},
	{
		id: 'sphereDiameterMm',
		kind: 'number',
		label: m.export_opt_supports_sphere_label,
		min: L.sphereDiameterMm.min,
		max: L.sphereDiameterMm.max,
		step: L.sphereDiameterMm.step,
		default: 0.2,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_sphere_help
	},
	{
		id: 'raftDepthMm',
		kind: 'number',
		label: m.export_opt_supports_raft_label,
		min: L.raftDepthMm.min,
		max: L.raftDepthMm.max,
		step: L.raftDepthMm.step,
		default: 0.2,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_raft_help
	},
	{
		id: 'raftSizeMm',
		kind: 'number',
		label: m.export_opt_supports_raft_size_label,
		min: L.raftSizeMm.min,
		max: L.raftSizeMm.max,
		step: L.raftSizeMm.step,
		default: 1,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_raft_size_help
	},
	{
		id: 'edgeInsetMm',
		kind: 'number',
		label: m.export_opt_supports_inset_label,
		min: L.edgeInsetMm.min,
		max: L.edgeInsetMm.max,
		step: L.edgeInsetMm.step,
		default: 0.6,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_inset_help
	},
	{
		id: 'edgeSpacingMm',
		kind: 'number',
		label: m.export_opt_supports_spacing_label,
		min: L.edgeSpacingMm.min,
		max: L.edgeSpacingMm.max,
		step: L.edgeSpacingMm.step,
		default: 1,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_spacing_help
	},
	{
		id: 'legendSpacingMm',
		kind: 'number',
		label: m.export_opt_supports_legend_spacing_label,
		min: L.legendSpacingMm.min,
		max: L.legendSpacingMm.max,
		step: L.legendSpacingMm.step,
		default: 1,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_legend_spacing_help
	},
	{
		id: 'faceMinAngleDeg',
		kind: 'number',
		label: m.export_opt_supports_face_angle_label,
		min: L.faceMinAngleDeg.min,
		max: L.faceMinAngleDeg.max,
		step: L.faceMinAngleDeg.step,
		default: 10,
		unit: m.export_unit_deg,
		help: m.export_opt_supports_face_angle_help
	},
	{
		id: 'maxHeadLeanDeg',
		kind: 'number',
		label: m.export_opt_supports_lean_label,
		min: L.maxHeadLeanDeg.min,
		max: L.maxHeadLeanDeg.max,
		step: L.maxHeadLeanDeg.step,
		default: 45,
		unit: m.export_unit_deg,
		help: m.export_opt_supports_lean_help
	},
	{
		id: 'postDiameterMm',
		kind: 'number',
		label: m.export_opt_supports_post_diameter_label,
		min: L.postDiameterMm.min,
		max: L.postDiameterMm.max,
		step: L.postDiameterMm.step,
		default: 1.5,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_post_diameter_help
	},
	{
		id: 'postFinThicknessMm',
		kind: 'number',
		label: m.export_opt_supports_post_fin_label,
		min: L.postFinThicknessMm.min,
		max: L.postFinThicknessMm.max,
		step: L.postFinThicknessMm.step,
		default: 0.15,
		unit: m.export_unit_mm,
		help: m.export_opt_supports_post_fin_help
	}
];

export function supportSettingsFromValues(values: OptionValues): SupportSettings {
	return mergeSupportSettings({
		pillarDiameterMm: Number(controlValue(controls, values, 'pillarDiameterMm')),
		coneLengthMm: Number(controlValue(controls, values, 'coneLengthMm')),
		sphereDiameterMm: Number(controlValue(controls, values, 'sphereDiameterMm')),
		raftDepthMm: Number(controlValue(controls, values, 'raftDepthMm')),
		raftSizeMm: Number(controlValue(controls, values, 'raftSizeMm')),
		edgeInsetMm: Number(controlValue(controls, values, 'edgeInsetMm')),
		edgeSpacingMm: Number(controlValue(controls, values, 'edgeSpacingMm')),
		legendSpacingMm: Number(controlValue(controls, values, 'legendSpacingMm')),
		faceMinAngleDeg: Number(controlValue(controls, values, 'faceMinAngleDeg')),
		maxHeadLeanDeg: Number(controlValue(controls, values, 'maxHeadLeanDeg')),
		postDiameterMm: Number(controlValue(controls, values, 'postDiameterMm')),
		postFinThicknessMm: Number(controlValue(controls, values, 'postFinThicknessMm'))
	});
}

export function supportLayersFromValues(values: OptionValues): SupportLayerVisibility {
	return {
		edges: Boolean(controlValue(controls, values, 'layerEdges')),
		legends: Boolean(controlValue(controls, values, 'layerLegends')),
		tipPost: Boolean(controlValue(controls, values, 'layerTipPost'))
	};
}

export const supportsOption: ExtraBuildOption = {
	id: 'supports',
	label: m.export_opt_supports_label,
	description: m.export_opt_supports_description,
	defaultEnabled: false,
	// Union into the printable die / blank — not a separate support body.
	mergeInto: ['dice', 'blanks'],
	controls,
	generate(ctx) {
		try {
			return generateSupports(ctx);
		} catch (e) {
			if (e instanceof SupportCancelledError) {
				return [];
			}
			throw e;
		}
	}
};

function generateSupports(ctx: ExtraBuildContext) {
	const settings = supportSettingsFromValues(ctx.values);
	const layers = supportLayersFromValues(ctx.values);
	if (!layers.edges && !layers.legends && !layers.tipPost) {
		return [];
	}
	const faces = ctx.builder.getFaces();
	const printT = ctx.builder.getPrintingTransform();
	const faceShapes = orientFaceLegendShapes(
		faces,
		ctx.die.face_parameters,
		ctx.legends,
		(l) => ctx.builder.getDefaultScaleForLegend(l)
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
