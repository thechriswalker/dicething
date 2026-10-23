export {
	cloneSupportConfig,
	effectiveDieSupports,
	effectiveSetSupports,
	globalSupportConfig,
	normalizeStoredSupports,
	parseSupportConfig,
	supportConfigEqual,
	type SupportConfig
} from './config';

export {
	DEFAULT_SUPPORT_SETTINGS,
	DEFAULT_SUPPORT_LAYER_VISIBILITY,
	RAFT_WALL_FROM_PLATE_DEG,
	SUPPORT_SETTING_LIMITS,
	SupportCancelledError,
	assertNotCancelled,
	filterSupportRegions,
	mergeSupportSettings,
	type SupportCancelToken,
	type SupportContact,
	type SupportEdgeLine,
	type SupportLayerVisibility,
	type SupportLegendPoint,
	type SupportProgressFn,
	type SupportRegions,
	type SupportSettings,
	type SupportTipPost
} from './types';

export {
	collectSharpEdges,
	computeEdgeSupportLines,
	computeSupportRegions,
	detectTipPost,
	edgeInsetForSphere,
	faceAngleFromVerticalDeg,
	faceNeedsEdgeSupports,
	faceSlopesOutward,
	outwardFacesAtEdge,
	edgeHasVerticalFace,
	faceIsVertical,
	insetSupportFacesAtEdge,
	isBaseRestingEdge,
	pointInLegendEngraving,
	printPointToFaceLocal,
	carveEngravingFromSupportLines,
	clipSupportLineForSphere,
	trimSegmentEnds,
	detectLegendSupports,
	detectLegendSupportsLocalMinima,
	faceNormalPrint,
	facePointPrint,
	insetSegmentOntoFace,
	lowerHalfSegment,
	supportEdgeSegment,
	orientFaceLegendShapes,
	setLegendSupportDetector,
	type LegendSupportDetector,
	type LegendSupportInput
} from './regions';

export {
	borrowDiePrintClone,
	buildSingleSupportManifold,
	buildSupportsManifold,
	iterateSupportSolids,
	meshFromSupportSolid,
	placeSupportFoot,
	sampleSupportContacts,
	type BuildSupportsResult
} from './geometry';

export { buildTipPostManifold } from './tip_post';

export {
	buildSupportRaft,
	raftHoleCenter,
	RAFT_HOLE_FLAT_MM,
	RAFT_HOLE_WALL_MM,
	type RaftFoot
} from './raft';

export { buildPlacementOverlay, disposeOverlayGroup, serializeRegions } from './placement';
