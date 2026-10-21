// Background engraving-bounds checks for the whole set. Separate from the
// viewport worker so fitting legends never sits ahead of pointer events.

import { DOMParser } from 'xmldom';
if (typeof (globalThis as { DOMParser?: unknown }).DOMParser === 'undefined') {
	(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
}

import type { Dice } from '$lib/interfaces/storage.svelte';
import type { EngravingError } from './builder';
import { dieJsonReviver } from './die_worker_parse';
import { computeEngravingBoundsErrors } from './engraving_bounds';
import { resolveWorkerLegends } from './die_worker_legends';

export type EngravingCheckRequest = {
	kind: 'check';
	generation: number;
	diceJson: string;
	legendsJson: string;
};

export type EngravingCheckResponse = {
	type: 'dieErrors';
	generation: number;
	dieId: string;
	errors: Array<EngravingError>;
};

let latestGeneration = 0;
let pending: EngravingCheckRequest | undefined;
let pumping = false;

function post(msg: EngravingCheckResponse) {
	(self as unknown as Worker).postMessage(msg);
}

/** Let a newer check message land before the next die starts. */
function yieldTurn(): Promise<void> {
	return new Promise((resolve) => {
		const channel = new MessageChannel();
		channel.port1.onmessage = () => resolve();
		channel.port2.postMessage(null);
	});
}

async function run(job: EngravingCheckRequest) {
	const dice = JSON.parse(job.diceJson, dieJsonReviver) as Dice[];
	const legends = await resolveWorkerLegends(job.legendsJson, '');
	for (let i = 0; i < dice.length; i++) {
		if (job.generation !== latestGeneration) {
			return;
		}
		const die = dice[i];
		let errors: Array<EngravingError> = [];
		try {
			errors = computeEngravingBoundsErrors(die, legends);
		} catch (e) {
			console.warn('engraving bounds check failed', die.kind, e);
		}
		if (job.generation !== latestGeneration) {
			return;
		}
		post({ type: 'dieErrors', generation: job.generation, dieId: die.id, errors });
		if (i < dice.length - 1) {
			await yieldTurn();
		}
	}
}

async function pump() {
	if (pumping) {
		return;
	}
	pumping = true;
	try {
		while (pending) {
			const job = pending;
			pending = undefined;
			if (job.generation !== latestGeneration) {
				continue;
			}
			await run(job);
		}
	} finally {
		pumping = false;
		if (pending) {
			void pump();
		}
	}
}

self.onmessage = (event: MessageEvent<EngravingCheckRequest>) => {
	const msg = event.data;
	if (msg.kind !== 'check') {
		return;
	}
	latestGeneration = msg.generation;
	pending = msg;
	void pump();
};
