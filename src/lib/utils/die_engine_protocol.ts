// Message protocol shared between die-engine.worker.ts and die_engine_client.ts.
// No runtime imports — types only.

import type { EngravingError } from './builder';
import type { MeshCheckReport } from './mesh_check';
import type { SerialisedLegendSet } from './legends';

// --- Storage snapshots (plain JSON, no three.js) --------------------------------

export type StorageDiceSetSnapshot = {
	id: string;
	name: string;
	updated: number;
	dice: string;
	legendsId: string;
};

export type StorageUpdatedPayload = {
	sets: Array<StorageDiceSetSnapshot>;
	legends: Array<SerialisedLegendSet>;
};

// --- Die build metadata (UI facade, no geometry) --------------------------------

export type DieFaceSnapshot = {
	index: number;
	defaultLegend: number;
	isNumberFace: boolean;
	hidden: boolean;
	convex: boolean;
};

export type DieBuildMetadata = {
	dieId: string;
	generation: number;
	faces: Array<DieFaceSnapshot>;
	approximateVolume: number;
	face2FaceDistance: number;
	individualLegendScaling: boolean;
	smallestLegendScaling: number;
	legendScaling: Record<number, number>;
	engravingErrors: Array<EngravingError>;
};

// --- Pointer / viewport -----------------------------------------------------------

export type EnginePointerEvent = {
	type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointerleave' | 'wheel';
	offsetX: number;
	offsetY: number;
	clientWidth: number;
	clientHeight: number;
	buttons: number;
	button?: number;
	pointerId?: number;
	shiftKey: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	deltaY?: number;
};

export type EngineSelectionState = {
	dieId: string;
	hoverFace: number;
	clickFace?: number;
	shiftKey?: boolean;
	altKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
};

export type EngineOutlineState = {
	primaryFaces: Array<number>;
	secondaryFaces: Array<number>;
	legendAreaFaces: Array<number>;
	legendErrorFaces: Array<number>;
};

// --- Export geometry (flat buffers) ---------------------------------------------

export type SerialisedEngineGeometry = {
	position: Float32Array;
	index?: Uint32Array;
};

export type SerialisedExportMesh = {
	name: string;
	dieId: string;
	group: string;
	geometry: SerialisedEngineGeometry;
};

// --- Requests (main → worker) ---------------------------------------------------

export type EngineRequestKind =
	| 'storage.init'
	| 'storage.getSets'
	| 'storage.saveSet'
	| 'storage.deleteSet'
	| 'storage.saveLegend'
	| 'storage.deleteLegend'
	| 'initViewport'
	| 'detachViewport'
	| 'resizeViewport'
	| 'pointer'
	| 'camera.reset'
	| 'camera.lookAtFace'
	| 'loadSet'
	| 'setActiveDie'
	| 'patchDie'
	| 'buildDie'
	| 'setExploded'
	| 'setAutoRotate'
	| 'setLegendAreaVisible'
	| 'setFancy'
	| 'setWireframe'
	| 'setOutline'
	| 'setBackground'
	| 'exportDie'
	| 'meshCheck';

export type EngineRequest = {
	reqId: number;
	kind: EngineRequestKind;
} & (
	| { kind: 'storage.init' }
	| { kind: 'storage.getSets' }
	| { kind: 'storage.saveSet'; setJson: string }
	| { kind: 'storage.deleteSet'; setId: string }
	| { kind: 'storage.saveLegend'; legendJson: string }
	| { kind: 'storage.deleteLegend'; legendId: string }
	| {
			kind: 'initViewport';
			width: number;
			height: number;
			dpr: number;
			backgroundColor: number;
			canvas: OffscreenCanvas;
	  }
	| { kind: 'detachViewport' }
	| { kind: 'resizeViewport'; width: number; height: number; dpr: number }
	| { kind: 'pointer'; event: EnginePointerEvent }
	| { kind: 'camera.reset' }
	| { kind: 'camera.lookAtFace'; faceIndex: number }
	| { kind: 'loadSet'; setId: string; setJson: string; legendsJson: string }
	| { kind: 'setActiveDie'; dieId: string }
	| {
			kind: 'patchDie';
			dieId: string;
			dieJson: string;
			explode: boolean;
			generation: number;
	  }
	| {
			kind: 'buildDie';
			dieId: string;
			dieJson: string;
			explode: boolean;
			generation: number;
			mountViewport?: boolean;
	  }
	| { kind: 'setExploded'; explode: boolean }
	| { kind: 'setAutoRotate'; enabled: boolean }
	| { kind: 'setLegendAreaVisible'; visible: boolean }
	| { kind: 'setFancy'; enabled: boolean }
	| { kind: 'setWireframe'; enabled: boolean }
	| { kind: 'setOutline'; state: EngineOutlineState }
	| { kind: 'setBackground'; backgroundColor: number }
	| {
			kind: 'exportDie';
			dieJson: string;
			legendsJson: string;
			includeDice: boolean;
			optionStatesJson: string;
	  }
	| { kind: 'meshCheck'; positions: Float32Array; collectBad?: boolean }
);

// --- Responses (worker → main) --------------------------------------------------

export type EngineProgress = {
	phase: string;
	label?: string;
	fraction?: number;
};

export type EngineResponse =
	| { reqId: number; type: 'progress'; progress: EngineProgress }
	| { reqId: number; type: 'storageUpdated'; payload: StorageUpdatedPayload }
	| { reqId: number; type: 'buildDone'; metadata: DieBuildMetadata }
	| { reqId: number; type: 'selection'; state: EngineSelectionState }
	| {
			reqId: number;
			type: 'exportResult';
			meshes: Array<SerialisedExportMesh>;
			engravingErrors: Array<EngravingError>;
			// Indexed Manifold topology when available (avoids weld false-positives).
			meshReport: MeshCheckReport;
			// Enclosed volume (mm³) per export group, from Manifold.volume() while
			// the solids are still alive. Keyed by group id ('dice', 'blanks', …).
			groupVolumesMm3: Record<string, number>;
	  }
	| { reqId: number; type: 'meshCheckResult'; report: MeshCheckReport }
	| { reqId: number; type: 'ok' }
	| { reqId: number; type: 'error'; error: string };

// Push events (no reqId)
export type EnginePush =
	| { type: 'storageBroadcast'; payload: StorageUpdatedPayload }
	| { type: 'selection'; state: EngineSelectionState };

export const ENGINE_STORAGE_CHANNEL = 'dicething-storage';
