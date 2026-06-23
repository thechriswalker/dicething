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
	// a temporary lower bound for undo. while set, undo cannot step before this
	// snapshot. used by format-painter mode so only paint ops are undoable, but
	// the earlier history is preserved and reachable again once released.
	let floor = $state(0);

	return {
		get canUndo() {
			return index > floor;
		},
		get canRedo() {
			return index >= 0 && index < entries.length - 1;
		},

		reset(initial: string) {
			entries = [initial];
			index = 0;
			suppress = false;
			floor = 0;
		},

		// pin the undo floor to the current position (e.g. on entering a mode).
		setFloor() {
			floor = index;
		},
		// release the floor so the full history is undoable again.
		releaseFloor() {
			floor = 0;
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
				const removed = next.length - limit;
				next.splice(0, removed);
				// keep the floor pointing at the same snapshot after eviction.
				floor = Math.max(0, floor - removed);
			}
			entries = next;
			index = entries.length - 1;
		},

		undo(): string | undefined {
			if (index <= floor) {
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
