// get the RGB value for a CSS color.

import { browser } from '$app/environment';

class RGB {
	constructor(
		private r: number,
		private g: number,
		private b: number
	) {}

	// returns the number used in three.js
	public toNumber(): number {
		return (this.r << 16) + (this.g << 8) + this.b;
	}

	public toString(): string {
		return '#' + this.toNumber().toString(16).padStart(6, '0');
	}

	public lighten(percent: number) {
		return this.interpolate(percent, 255);
	}
	public darken(percent: number) {
		return this.interpolate(percent, 0);
	}
	public interpolate(
		percent: number,
		targetR: number,
		targetG: number = targetR,
		targetB: number = targetR
	) {
		const r = this.r + Math.round(percent * (targetR - this.r));
		const g = this.g + Math.round(percent * (targetG - this.g));
		const b = this.b + Math.round(percent * (targetB - this.b));
		return new RGB(r, g, b);
	}
}

const cache = new Map<string, RGB>();

export function getRGB(cssColor: string): RGB {
	let c = cache.get(cssColor);
	if (!c) {
		c = getRGBFromCanvas(cssColor);
		cache.set(cssColor, c);
	}
	return c;
}

let getRGBFromCanvas = (_: string) => {
	return new RGB(0, 0, 0);
};

if (browser) {
	const cvs = new OffscreenCanvas(1, 1);
	const ctx = cvs.getContext('2d');
	if (ctx) {
		getRGBFromCanvas = (cssColor) => {
			ctx.fillStyle = cssColor;
			ctx.fillRect(0, 0, 1, 1);
			const data = ctx.getImageData(0, 0, 1, 1).data;
			//
			return new RGB(data[0], data[1], data[2]);
		};
	}
}
