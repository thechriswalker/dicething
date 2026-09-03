import { describe, it, expect } from 'vitest';
import { isCatalogueDiePreview, diePreviewCacheKey } from '$lib/utils/die_preview_key';
import { pickLegendSetsToEvict } from '$lib/utils/die_preview_idb';
import {
	canUseStaticDiePreview,
	legendPreviewSlug,
	staticDiePreviewUrl
} from '$lib/utils/die_preview_static';
import { blanks } from '$lib/fonts';
import type { Dice } from '$lib/interfaces/storage.svelte';
import { loadImmutableLegends } from '$lib/utils/legends';

const catalogueDie = (kind = 'd6_cube'): Dice => ({
	id: 'preview:' + kind,
	kind: kind as Dice['kind'],
	parameters: {},
	face_parameters: []
});

describe('die preview key / static eligibility', () => {
	it('catalogue dice with empty params are static-eligible for builtins', () => {
		expect(isCatalogueDiePreview(catalogueDie())).toBe(true);
		expect(canUseStaticDiePreview(catalogueDie(), blanks)).toBe(true);
	});

	it('rejects non-default params / ordering for static', () => {
		expect(
			isCatalogueDiePreview({
				...catalogueDie(),
				parameters: { polyhedron_size: 20 }
			})
		).toBe(false);
		expect(
			isCatalogueDiePreview({
				...catalogueDie(),
				legend_ordering: 'spindown'
			})
		).toBe(false);
	});

	it('rejects custom legend sets for static', () => {
		const custom = loadImmutableLegends({
			id: 'custom-abc',
			name: 'Custom',
			shapes: []
		});
		expect(canUseStaticDiePreview(catalogueDie(), custom)).toBe(false);
	});

	it('builds stable urls / slugs', () => {
		expect(legendPreviewSlug('builtin:germania_one')).toBe('germania_one');
		expect(staticDiePreviewUrl('d12_dodecahedron', 'builtin:blanks')).toBe(
			'/previews/d12_dodecahedron/blanks.webp'
		);
	});

	it('cache key includes legend identity and die params', () => {
		const a = diePreviewCacheKey(catalogueDie(), 'custom-1', 100);
		const b = diePreviewCacheKey(catalogueDie(), 'custom-1', 200);
		expect(a).not.toEqual(b);
	});
});

describe('die preview legend-set LRU', () => {
	it('evicts oldest whole legend sets when over cap', () => {
		const entries = [
			{ legendSetId: 'a', accessedAt: 1 },
			{ legendSetId: 'b', accessedAt: 3 },
			{ legendSetId: 'c', accessedAt: 2 }
		];
		expect(pickLegendSetsToEvict(entries, 2)).toEqual(['a']);
		expect(pickLegendSetsToEvict(entries, 3)).toEqual([]);
		expect(pickLegendSetsToEvict(entries, 1)).toEqual(['a', 'c']);
	});
});
