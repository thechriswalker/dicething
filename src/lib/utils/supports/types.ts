import type { Vector3 } from 'three';

/** Tunable sizes for SLA auto-supports (millimetres / degrees). */
export type SupportSettings = {
	pillarDiameterMm: number;
	coneLengthMm: number;
	sphereDiameterMm: number;
	raftDepthMm: number;
	/** Raft pad radius on the build plate (mm); pads are hexagonal. */
	raftSizeMm: number;
	/** How far contacts sit inward from a sharp edge onto the face. */
	edgeInsetMm: number;
	/** Centre-to-centre distance between support contacts along an edge. */
	edgeSpacingMm: number;
	/** Target spacing along legend contours between weakness anchors. */
	legendSpacingMm: number;
	/**
	 * Minimum outward lean from vertical (degrees) for a face to receive edge
	 * supports. 0 = vertical; positive = outward. Near-vertical faces still get
	 * legend supports.
	 */
	faceMinAngleDeg: number;
	maxHeadLeanDeg: number;
	/** Tip-down apex post stump diameter (mm). */
	postDiameterMm: number;
	/** Tip-post fin thickness along each tip edge (mm). */
	postFinThicknessMm: number;
};

export const SUPPORT_SETTING_LIMITS = {
	pillarDiameterMm: { min: 0.2, max: 2, step: 0.05 },
	coneLengthMm: { min: 2, max: 8, step: 0.1 },
	sphereDiameterMm: { min: 0.1, max: 0.5, step: 0.05 },
	raftDepthMm: { min: 0, max: 2, step: 0.05 },
	raftSizeMm: { min: 0.5, max: 4, step: 0.25 },
	edgeInsetMm: { min: 0.1, max: 1, step: 0.05 },
	// Dense spacing can spawn many pillars; floor at 0.5mm to keep the worker responsive.
	edgeSpacingMm: { min: 0.5, max: 8, step: 0.25 },
	legendSpacingMm: { min: 0.5, max: 8, step: 0.25 },
	faceMinAngleDeg: { min: 0, max: 60, step: 1 },
	maxHeadLeanDeg: { min: 0, max: 60, step: 5 },
	postDiameterMm: { min: 0.2, max: 3, step: 0.05 },
	postFinThicknessMm: { min: 0.1, max: 0.5, step: 0.05 }
} as const;

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
	pillarDiameterMm: 0.45,
	coneLengthMm: 3,
	sphereDiameterMm: 0.3,
	raftDepthMm: 0.2,
	raftSizeMm: 2.25,
	edgeInsetMm: 0.6,
	edgeSpacingMm: 1,
	legendSpacingMm: 1,
	faceMinAngleDeg: 15,
	maxHeadLeanDeg: 45,
	postDiameterMm: 1.5,
	postFinThicknessMm: 0.15
};

/**
 * Inset support run along a sharp edge, in print space (Y-up, plate y = 0).
 * Two points are a straight run. More points follow a curve (a chain of short
 * chords treated as one edge).
 */
export type SupportEdgeLine = {
	points: Array<Vector3>;
	normal: Vector3;
	/**
	 * When true, contact samples skip locations near legend supports (used for
	 * tetrahedron face-median rows that share the face with engraved legends).
	 */
	avoidLegends?: boolean;
	/** Face this run sits on — used to carve out engraved legend fill. */
	faceIndex?: number;
};

/** Contact point beside a legend island, in print space. */
export type SupportLegendPoint = {
	point: Vector3;
	normal: Vector3;
};

/** Tip-down apex post: stump under the lowest vertex + fins along tip edges. */
export type SupportTipPost = {
	apex: Vector3;
	/** Unit directions from the apex along each incident sharp edge. */
	edgeDirs: Array<Vector3>;
};

export type SupportRegions = {
	edgeLines: Array<SupportEdgeLine>;
	legendPoints: Array<SupportLegendPoint>;
	tipPost?: SupportTipPost;
};

/** Which support layers to include in a preview build (dev-mode toggles). */
export type SupportLayerVisibility = {
	edges: boolean;
	legends: boolean;
	tipPost: boolean;
};

export const DEFAULT_SUPPORT_LAYER_VISIBILITY: SupportLayerVisibility = {
	edges: true,
	legends: true,
	tipPost: true
};

export function filterSupportRegions(
	regions: SupportRegions,
	layers: SupportLayerVisibility
): SupportRegions {
	return {
		edgeLines: layers.edges ? regions.edgeLines : [],
		legendPoints: layers.legends ? regions.legendPoints : [],
		tipPost: layers.tipPost ? regions.tipPost : undefined
	};
}

/** A sampled contact ready for pillar generation. */
export type SupportContact = {
	point: Vector3;
	normal: Vector3;
	source: 'edge' | 'legend';
};

export type SupportProgressFn = (phase: string, fraction?: number, label?: string) => void;

export type SupportCancelToken = {
	cancelled: boolean;
};

function clamp(n: number, min: number, max: number): number {
	if (!Number.isFinite(n)) return min;
	return Math.min(max, Math.max(min, n));
}

export function mergeSupportSettings(partial?: Partial<SupportSettings> | null): SupportSettings {
	const s = { ...DEFAULT_SUPPORT_SETTINGS, ...(partial ?? {}) };
	const L = SUPPORT_SETTING_LIMITS;
	return {
		pillarDiameterMm: clamp(s.pillarDiameterMm, L.pillarDiameterMm.min, L.pillarDiameterMm.max),
		coneLengthMm: clamp(s.coneLengthMm, L.coneLengthMm.min, L.coneLengthMm.max),
		sphereDiameterMm: clamp(s.sphereDiameterMm, L.sphereDiameterMm.min, L.sphereDiameterMm.max),
		raftDepthMm: clamp(s.raftDepthMm, L.raftDepthMm.min, L.raftDepthMm.max),
		raftSizeMm: clamp(s.raftSizeMm, L.raftSizeMm.min, L.raftSizeMm.max),
		edgeInsetMm: clamp(s.edgeInsetMm, L.edgeInsetMm.min, L.edgeInsetMm.max),
		edgeSpacingMm: clamp(s.edgeSpacingMm, L.edgeSpacingMm.min, L.edgeSpacingMm.max),
		legendSpacingMm: clamp(s.legendSpacingMm, L.legendSpacingMm.min, L.legendSpacingMm.max),
		faceMinAngleDeg: clamp(s.faceMinAngleDeg, L.faceMinAngleDeg.min, L.faceMinAngleDeg.max),
		maxHeadLeanDeg: clamp(s.maxHeadLeanDeg, L.maxHeadLeanDeg.min, L.maxHeadLeanDeg.max),
		postDiameterMm: clamp(s.postDiameterMm, L.postDiameterMm.min, L.postDiameterMm.max),
		postFinThicknessMm: clamp(
			s.postFinThicknessMm,
			L.postFinThicknessMm.min,
			L.postFinThicknessMm.max
		)
	};
}

export function assertNotCancelled(token?: SupportCancelToken): void {
	if (token?.cancelled) {
		throw new SupportCancelledError();
	}
}

export class SupportCancelledError extends Error {
	constructor() {
		super('supports cancelled');
		this.name = 'SupportCancelledError';
	}
}
