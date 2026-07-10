// Dev tracing for die-engine load / request timing. Enabled in DEV, or set
// localStorage 'dt:engine-trace' = '1' in production.
// Avoid $app/environment — it cannot be resolved in worker bundles.
const canTrace =
	typeof globalThis !== 'undefined' &&
	(typeof window !== 'undefined' || typeof self !== 'undefined');

let origin = 0;

function enabled(): boolean {
	if (!canTrace) {
		return false;
	}
	if (import.meta.env.DEV) {
		return true;
	}
	try {
		return typeof localStorage !== 'undefined' && localStorage.getItem('dt:engine-trace') === '1';
	} catch {
		return false;
	}
}

function sinceOrigin(): number {
	if (origin === 0) {
		origin = performance.now();
	}
	return performance.now() - origin;
}

export function resetEngineTraceOrigin(): void {
	origin = performance.now();
}

export function engineTrace(phase: string, detail?: Record<string, unknown>): void {
	if (!enabled()) {
		return;
	}
	const extra = detail ? ` ${JSON.stringify(detail)}` : '';
	console.log(`[engine +${sinceOrigin().toFixed(0)}ms] ${phase}${extra}`);
}

export function engineTraceSpan(phase: string) {
	if (!enabled()) {
		return { end: (_detail?: Record<string, unknown>) => {} };
	}
	const start = performance.now();
	engineTrace(`→ ${phase}`);
	return {
		end(detail?: Record<string, unknown>) {
			engineTrace(`← ${phase}`, { ms: Math.round(performance.now() - start), ...detail });
		}
	};
}

export function engineTraceEnabled(): boolean {
	return enabled();
}
