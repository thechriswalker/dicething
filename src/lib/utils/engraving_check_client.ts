import { browser } from '$app/environment';
import type { EngravingError } from './builder';
import EngravingCheckWorker from './engraving_check.worker?worker';
import type { EngravingCheckRequest, EngravingCheckResponse } from './engraving_check.worker';

let worker: Worker | undefined;
let activeGeneration = 0;
let onDie: ((dieId: string, errors: Array<EngravingError>) => void) | undefined;

function getWorker(): Worker {
	if (!worker) {
		worker = new EngravingCheckWorker({ name: 'engraving-check' });
		worker.addEventListener('message', (event: MessageEvent<EngravingCheckResponse>) => {
			const msg = event.data;
			if (msg.type !== 'dieErrors' || msg.generation !== activeGeneration) {
				return;
			}
			onDie?.(msg.dieId, msg.errors);
		});
		worker.addEventListener('error', (e) => console.error('engraving-check worker error', e));
	}
	return worker;
}

/** Replace any in-flight set check. Results arrive one die at a time. */
export function requestEngravingBoundsCheck(
	diceJson: string,
	legendsJson: string,
	generation: number,
	handler: (dieId: string, errors: Array<EngravingError>) => void
): void {
	if (!browser) {
		return;
	}
	activeGeneration = generation;
	onDie = handler;
	const msg: EngravingCheckRequest = { kind: 'check', generation, diceJson, legendsJson };
	getWorker().postMessage(msg);
}
