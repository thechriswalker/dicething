// Message protocol shared between the box worker (box.worker.ts) and its
// main-thread client (box_client.ts). Kept in its own module (no runtime
// imports) so both sides agree on the shapes without dragging worker-only or
// main-thread-only code across the boundary.

import type { BuildProgress } from './box_builder';
import type { SerialisedBuiltBox, SerialisedPreparedLayout } from './serialize';

export type BoxRequestKind = 'build' | 'layout';

export type BoxRequest = {
	reqId: number;
	kind: BoxRequestKind;
	// the set's dice, serialised with the v2-aware stringifier (diceToJSON).
	dice: string;
	// the BoxConfig, plain JSON (it carries no three.js objects).
	config: string;
};

export type BoxResponse =
	| { reqId: number; type: 'progress'; progress: BuildProgress }
	| { reqId: number; type: 'result'; kind: 'build'; result: SerialisedBuiltBox }
	| { reqId: number; type: 'result'; kind: 'layout'; result: SerialisedPreparedLayout }
	| { reqId: number; type: 'error'; error: string };
