// Message protocol for die_preview.worker.ts ↔ die_preview_client.ts.

export type PreviewRequestKind = 'previewDie' | 'warmKinds';

export type PreviewRequest = {
	reqId: number;
	kind: PreviewRequestKind;
} & (
	| {
			kind: 'previewDie';
			dieJson: string;
			legendSetId: string;
			legendUpdated?: number;
			legendsJson?: string;
	  }
	| { kind: 'warmKinds'; legendSetId: string; legendUpdated?: number; legendsJson: string }
);

export type PreviewResponse =
	| { reqId: number; type: 'previewResult'; dieId: string; bitmap: ImageBitmap }
	| { reqId: number; type: 'ok' }
	| { reqId: number; type: 'error'; error: string };
