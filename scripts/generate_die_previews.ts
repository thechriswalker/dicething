// Generate static/previews/{kind}/{legend}.webp for every die × builtin legend.
//
// Spawns `vite dev` with HMR/watch disabled, then renders one thumbnail at a
// time via Playwright (retries if the page context is lost).
//
//   bun run generate:previews

import { spawn, type ChildProcess } from 'node:child_process';
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = resolve(root, 'static/previews');
const PORT = 5193;
const BASE = `http://127.0.0.1:${PORT}`;
const GEN_URL = `${BASE}/sandbox/preview-gen`;

async function waitForServer(url: string, timeoutMs = 120_000): Promise<void> {
	const start = Date.now();
	let lastErr: unknown;
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(url, { redirect: 'manual' });
			if (res.status > 0) {
				return;
			}
		} catch (e) {
			lastErr = e;
		}
		await new Promise((r) => setTimeout(r, 250));
	}
	throw new Error(`timed out waiting for ${url}: ${lastErr}`);
}

function startDevServer(): ChildProcess {
	const child = spawn(
		'bun',
		[
			'x',
			'vite',
			'dev',
			'--config',
			'vite.preview-gen.config.ts',
			'--port',
			String(PORT),
			'--host',
			'127.0.0.1',
			'--strictPort'
		],
		{
			cwd: root,
			stdio: ['ignore', 'pipe', 'pipe'],
			env: { ...process.env, BROWSER: 'none' }
		}
	);
	child.stdout?.on('data', (buf: Buffer) => {
		const s = buf.toString();
		if (/error/i.test(s)) {
			process.stderr.write(s);
		}
	});
	child.stderr?.on('data', (buf: Buffer) => {
		process.stderr.write(buf);
	});
	child.on('exit', (code, signal) => {
		if (code && code !== 0 && code !== 143) {
			console.error(`vite exited code=${code} signal=${signal}`);
		}
	});
	return child;
}

function stopDevServer(child: ChildProcess): Promise<void> {
	return new Promise((resolveStop) => {
		if (child.exitCode !== null) {
			resolveStop();
			return;
		}
		child.once('exit', () => resolveStop());
		child.kill('SIGTERM');
		setTimeout(() => {
			if (child.exitCode === null) {
				child.kill('SIGKILL');
			}
		}, 2000);
	});
}

async function openGenPage(browser: Browser): Promise<Page> {
	const page = await browser.newPage();
	page.on('console', (msg) => {
		if (msg.type() === 'error') {
			console.error('page:', msg.text());
		}
	});
	page.on('pageerror', (err) => console.error('pageerror:', err));
	await page.goto(GEN_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
	await page.waitForFunction(
		() =>
			typeof (window as unknown as { __dicethingRenderPreview?: unknown })
				.__dicethingRenderPreview === 'function',
		{ timeout: 120_000 }
	);
	return page;
}

async function renderWithRetry(
	browser: Browser,
	pageRef: { page: Page },
	kind: string,
	legendKey: string
): Promise<string> {
	const maxAttempts = 3;
	let lastErr: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await pageRef.page.evaluate(
				async ({ kind, legendKey }) => {
					const w = window as unknown as {
						__dicethingRenderPreview: (kind: string, legendKey: string) => Promise<string>;
					};
					return w.__dicethingRenderPreview(kind, legendKey);
				},
				{ kind, legendKey }
			);
		} catch (e) {
			lastErr = e;
			const msg = e instanceof Error ? e.message : String(e);
			if (!/Execution context was destroyed|Target closed|Session closed/i.test(msg)) {
				throw e;
			}
			console.warn(`retry ${attempt}/${maxAttempts} after context loss (${kind}/${legendKey})`);
			try {
				await pageRef.page.close();
			} catch {
				// already gone
			}
			pageRef.page = await openGenPage(browser);
		}
	}
	throw lastErr;
}

async function main() {
	const tmpOut = mkdtempSync(join(tmpdir(), 'dicething-previews-'));
	const child = startDevServer();
	let browser: Browser | undefined;
	try {
		console.log(`starting vite on ${BASE}…`);
		await waitForServer(GEN_URL);
		console.log('vite ready');
		console.log('writing temp previews to', tmpOut);

		browser = await chromium.launch({ headless: true });
		const pageRef = { page: await openGenPage(browser) };

		const { kinds, legendKeys } = await pageRef.page.evaluate(() => {
			const w = window as unknown as {
				__dicethingPreviewCatalogue: () => { kinds: string[]; legendKeys: string[] };
			};
			return w.__dicethingPreviewCatalogue();
		});

		const total = kinds.length * legendKeys.length;
		let done = 0;
		console.log(`generating ${total} previews (${kinds.length} kinds × ${legendKeys.length} legends)…`);

		for (const legendKey of legendKeys) {
			for (const kind of kinds) {
				const base64 = await renderWithRetry(browser, pageRef, kind, legendKey);
				const dir = join(tmpOut, kind);
				mkdirSync(dir, { recursive: true });
				writeFileSync(join(dir, `${legendKey}.webp`), Buffer.from(base64, 'base64'));
				done++;
				console.log(`${done}/${total} ${kind}/${legendKey}`);
			}
		}

		await pageRef.page.close();
		await browser.close();
		browser = undefined;

		await stopDevServer(child);

		mkdirSync(outRoot, { recursive: true });
		cpSync(tmpOut, outRoot, { recursive: true });
		console.log('wrote previews to', outRoot);
	} finally {
		if (browser) {
			await browser.close().catch(() => {});
		}
		await stopDevServer(child);
		rmSync(tmpOut, { recursive: true, force: true });
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
