// A small undo/redo stack using the classic index-pointer model:
// - `entries` holds serialized snapshots, `index` points at the current one.
// - undo/redo walk `index` without destroying entries, so redo keeps working.
// - pushing a new snapshot truncates anything after `index` (the redo tail).
// - the stack is capped; the oldest entries are evicted from the front.
export function createHistory(limit = 100) {
	let entries = $state<string[]>([]);
	let index = $state(-1);
	// one-shot guard so an apply-triggered commit doesn't record itself.
	let suppress = false;

	return {
		get canUndo() {
			return index > 0;
		},
		get canRedo() {
			return index >= 0 && index < entries.length - 1;
		},

		reset(initial: string) {
			entries = [initial];
			index = 0;
			suppress = false;
		},

		push(snapshot: string) {
			if (suppress) {
				suppress = false;
				return;
			}
			if (index >= 0 && entries[index] === snapshot) {
				return;
			}
			// drop any redo tail, then append.
			const next = entries.slice(0, index + 1);
			next.push(snapshot);
			// evict from the front if we've grown past the cap.
			if (next.length > limit) {
				next.splice(0, next.length - limit);
			}
			entries = next;
			index = entries.length - 1;
		},

		undo(): string | undefined {
			if (index <= 0) {
				return undefined;
			}
			index -= 1;
			return entries[index];
		},

		redo(): string | undefined {
			if (index >= entries.length - 1) {
				return undefined;
			}
			index += 1;
			return entries[index];
		},

		// mark that the next push should be ignored (consumed once).
		markApplying() {
			suppress = true;
		}
	};
}
