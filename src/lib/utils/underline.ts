// Generate an underline bar beneath (or above) a legend's glyph(s). Used as an
// alternative to the dotted 6./9. marks. Operates on the compact serialized
// shape form so it composes with createShapesFromFont / createShapesFromSVG.
import { Box2, Shape } from 'three';
import type { UnderlineOptions } from './legends';
import { shapeFromJSON, shapeToJSON } from './to_json';

export const defaultUnderline: UnderlineOptions = {
	thickness: 0.8,
	gap: 0.6,
	widthScale: 1,
	flip: false
};

// Append an underline bar to a set of (serialized) shapes, sized to the glyph's
// bounding box. The glyph itself is left in place so its centering is unchanged;
// the bar is positioned just outside the glyph box on one side.
export function addUnderline(
	shapesJSON: Array<unknown>,
	opts: UnderlineOptions = defaultUnderline
): Array<unknown> {
	const shapes = shapesJSON.map((s) => shapeFromJSON(s));
	const box = new Box2();
	for (const s of shapes) {
		for (const p of s.getPoints(24)) {
			box.expandByPoint(p);
		}
		for (const h of s.holes) {
			for (const p of h.getPoints(24)) {
				box.expandByPoint(p);
			}
		}
	}
	if (!isFinite(box.min.x) || box.isEmpty()) {
		return shapesJSON;
	}

	const cx = (box.min.x + box.max.x) / 2;
	const halfW = ((box.max.x - box.min.x) / 2) * opts.widthScale;
	// the edge of the glyph box on the chosen side, plus the gap. By default the
	// bar sits beneath the glyph; in legend space (after the preview's Y flip)
	// that is the box.min.y side. `flip` puts it on the other side.
	const edge = opts.flip ? box.max.y + opts.gap : box.min.y - opts.gap;
	const other = opts.flip ? edge + opts.thickness : edge - opts.thickness;
	const top = Math.min(edge, other);
	const bot = Math.max(edge, other);

	const bar = new Shape();
	bar.moveTo(cx - halfW, top);
	bar.lineTo(cx + halfW, top);
	bar.lineTo(cx + halfW, bot);
	bar.lineTo(cx - halfW, bot);
	bar.closePath();

	return [...shapesJSON, shapeToJSON(bar)];
}
