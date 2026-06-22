import type { DiceParameter, DieFaceModel, DieModel, FaceParams } from '$lib/interfaces/dice';
import {
	BufferGeometry,
	Group,
	Material,
	Mesh,
	MeshBasicMaterial,
	MeshNormalMaterial,
	Quaternion,
	Vector3,
	Plane,
	type Object3D,
	Vector2,
	DoubleSide,
	PlaneGeometry
} from 'three';
import { DefaultDivisions, engrave, Part } from './engraving';
import { debugLegendName, Legend, type LegendSet } from './legends';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { removeDuplicateTriangles } from './bad_edges';
import { findBestLegendScalingFactor, getAreaOfShapeAtOrigin } from './shapes';
import { uuid } from './uuid';

const _m1 = new MeshNormalMaterial({ wireframe: !true });
const _m2 = new MeshBasicMaterial({ color: 0x000000 });
const _m3 = new MeshBasicMaterial({ color: 0xff0000, side: DoubleSide });

export class Builder {
	private renderCount = 0;
	private forceRerenderBlank = true;
	private forceRerenderFaces = true;
	private lastDieParams: Record<string, number> = {};
	private face2face: number = 0;
	private individualLegendScaling = false;
	public currentSmallestLegendScaling: number = 1;
	public readonly currentLegendScaling = new Map<Legend, number>();
	private faces: Array<DieFaceModel> = [];
	private faceObjects: Array<Object3D> = [];
	private lastFaceParams: Array<FaceParams> = [];

	// per-face solid ("n") and exploded ("e") target transforms, decomposed into
	// position + quaternion so the view layer can interpolate between them.
	private faceTransforms: Array<{
		nPos: Vector3;
		nQuat: Quaternion;
		ePos: Vector3;
		eQuat: Quaternion;
	}> = [];

	// animation state. progress goes 0 (solid) -> 1 (exploded).
	private exploded = false;
	private progress = 0;
	private targetProgress = 0;
	private lastAnimTime = 0;
	private hasBuilt = false;
	private static readonly EXPLODE_DURATION_MS = 400;

	// these two default to mesh normal
	private frontMaterial: Material = _m1;
	private wallMaterial: Material = _m1;

	// this to a flat grey
	private engraveMaterial: Material = _m2;
	private errorMaterial: Material = _m3;

	public readonly diceGroup = new Group();

	constructor(
		public model: DieModel,
		private legends: LegendSet,
		// this is the dice ID, so we can find it in the scene, or at least uniquely identify parts of _this_ dice
		private id = uuid() as string
	) {
		console.warn('Builder instantiated for', this.model.id, this.id);
	}

	public getFaces(): ReadonlyArray<DieFaceModel> {
		return this.faces;
	}

	// just get the front section of the face.
	getOutlineObjects(index: number): Array<Object3D> {
		const objs: Array<Object3D> = [];
		this.faceObjects[index]?.children.forEach((m) => {
			if (m.userData.diceThingPart === Part.Front) {
				objs.push(m);
			}
		});
		return objs;
	}

	public getApproximateVolume(): number {
		// we should cache this value as it only depends on
		// the die parameters, not the face ones (we ignore engraved material)
		// so the volume is the sum of the volumes of the pryamids from the faces
		// to the origin.
		// the volume of a pryamid is the base area x 1/3 x perpendicular height.
		// so we can find the perpendicular height of the face to the origin
		// by constructing a taking one normal from the face, constructing a plane
		// and then finding the distance from the origin to the plane.
		// but that requires the object to not be exploded,
		// so we need to use the faces transform to get the position of the center
		// of the face. 
		const volume = this.faces.reduce((sum, f, i) => {
			const area = getAreaOfShapeAtOrigin(f.shape);
			const obj = new PlaneGeometry(1,1);
			f.transform.applyToGeometry(obj);
			const position = obj.getAttribute('position');
			const plane = new Plane().setFromCoplanarPoints(
				new Vector3(position.getX(0), position.getY(0), position.getZ(0)),
				new Vector3(position.getX(1), position.getY(1), position.getZ(1)),
				new Vector3(position.getX(2), position.getY(2), position.getZ(2))
			);
			const height = plane.distanceToPoint(new Vector3(0, 0, 0));
			return sum + (area * height) / 3;
		}, 0);

		return volume;
	}

	getFace2FaceDistance(): number {
		return this.face2face;
	}

	changeLegends(set: LegendSet) {
		if (set.id === this.legends.id) {
			return;
		}
		this.legends = set;
		this.recalculateLegendScaling();
		this.forceRerenderFaces = true;
	}

	setFrontMaterial(mat: Material) {
		this.frontMaterial = mat;
		this.diceGroup.children.forEach((m) => {
			if ((m as Mesh).isMesh && m.userData.diceThingPart === Part.Front) {
				(m as Mesh).material = mat;
			}
		});
	}

	setWallMaterial(mat: Material) {
		this.wallMaterial = mat;
		this.diceGroup.children.forEach((m) => {
			if ((m as Mesh).isMesh && m.userData.diceThingPart === Part.Walls) {
				(m as Mesh).material = mat;
			}
		});
	}

	setEngravedMaterial(mat: Material) {
		this.engraveMaterial = mat;
		this.diceGroup.children.forEach((m) => {
			if ((m as Mesh).isMesh && m.userData.diceThingPart === Part.Engraved) {
				(m as Mesh).material = mat;
			}
		});
	}

	build(dieParams: Record<string, number>, faceParams: Array<FaceParams>, opts: { explode: boolean } = { explode: true }): number {
		dieParams = simplifyDieParams(dieParams, this.model.parameters);
		const dieChanged = this.forceRerenderBlank || !dieParamsEqual(this.lastDieParams, dieParams);
		if (dieChanged) {
			const x = this.model.build(dieParams);
			this.face2face = x.faceToFaceDistance;
			this.faces = x.faces;
			this.individualLegendScaling = !!x.sizeLegendsIndividually;
			this.recalculateLegendScaling();
			this.computeFaceTransforms();
			this.lastDieParams = dieParams;
		}
		for (let i = 0; i < this.faces.length; i++) {
			const newFaceParams = simplifyFaceParams(faceParams[i], this.faces[i]);
			if (
				dieChanged ||
				this.forceRerenderFaces ||
				faceParamsNotEqual(this.lastFaceParams[i], newFaceParams, this.faces[i])
			) {
				// need to rebuild
				if (!this.faceObjects[i]) {
					this.faceObjects[i] = new Group();
					this.faceObjects[i].userData.diceThingFace = i;
					this.faceObjects[i].userData.diceThingId = this.id;
					this.diceGroup.add(this.faceObjects[i]);
				} else {
					this.faceObjects[i].remove(...this.faceObjects[i].children);
				}
				this.lastFaceParams[i] = newFaceParams;
				this.buildFace(i, dieParams.engraving_depth, newFaceParams, { forExport: false }).forEach((g) => {
					g.userData.diceThingFace = i;
					g.userData.diceThingId = this.id;
					let m: Material;
					let visible = true;
					switch (g.userData.diceThingPart) {
						case Part.Engraved:
							m = this.engraveMaterial;
							break;
						case Part.Walls:
							m = this.wallMaterial;
							break;
						case Part.Front:
							m = this.frontMaterial;
							break;
						case Part.Symbol:
							m = this.errorMaterial;
							visible = !g.userData.diceThingSymbolOK;
							break;
						default:
							console.error('unknown part?', g);
							m = this.frontMaterial;
							break;
					}
					const mesh = new Mesh(g, m);
					mesh.userData = { ...g.userData };
					mesh.visible = visible;
					this.faceObjects[i].add(mesh);
				});
			}
		}
		this.forceRerenderBlank = false;
		this.forceRerenderFaces = false;

		// position/orient the (origin-built) face groups. on the first build we snap
		// straight to the requested state; afterwards we let any in-flight animation
		// continue, only updating where we're heading.
		this.targetProgress = opts.explode ? 1 : 0;
		this.exploded = opts.explode;
		if (!this.hasBuilt) {
			this.progress = this.targetProgress;
			this.hasBuilt = true;
		}
		this.lastAnimTime = now();
		this.applyProgress();

		this.renderCount++;
		return this.renderCount;
	}

	private computeFaceTransforms() {
		this.faceTransforms = this.faces.map((f) => {
			const explode = f.explodeTransform ?? f.transform;
			return {
				nPos: f.transform.translation,
				nQuat: f.transform.rotation,
				ePos: explode.translation,
				eQuat: explode.rotation
			};
		});
	}

	// set the desired state and (re)start the animation toward it.
	public setExploded(explode: boolean) {
		this.exploded = explode;
		this.targetProgress = explode ? 1 : 0;
		this.lastAnimTime = now();
	}

	public isExploded(): boolean {
		return this.exploded;
	}

	// advance the explode animation toward the target. returns true while still
	// moving so callers can know motion is ongoing. safe to call every frame.
	public update(time: number = now()): boolean {
		if (this.progress === this.targetProgress) {
			this.lastAnimTime = time;
			return false;
		}
		const dt = time - this.lastAnimTime;
		this.lastAnimTime = time;
		const step = dt / Builder.EXPLODE_DURATION_MS;
		if (this.targetProgress > this.progress) {
			this.progress = Math.min(this.targetProgress, this.progress + step);
		} else {
			this.progress = Math.max(this.targetProgress, this.progress - step);
		}
		this.applyProgress();
		return this.progress !== this.targetProgress;
	}

	private applyProgress() {
		const eased = easeInOut(this.progress);
		for (let i = 0; i < this.faceObjects.length; i++) {
			const g = this.faceObjects[i];
			const t = this.faceTransforms[i];
			if (!g || !t) {
				continue;
			}
			g.position.lerpVectors(t.nPos, t.ePos, eased);
			g.quaternion.slerpQuaternions(t.nQuat, t.eQuat, eased);
		}
	}

	private recalculateLegendScaling() {
		const face = this.faces.find((x) => x.isNumberFace);
		if (face) {
			let smallest = 1;
			this.currentLegendScaling.clear();
			// get the legends we want, and find the smallest scaling factor.
			// only consider legends on the number faces
			const allLegends = Array.from(
				new Set(
					this.faces.map((f, i) => {
						if (f.isNumberFace) {
							return this.lastFaceParams[i]?.legend ?? f.defaultLegend;
						}
						return Legend.BLANK;
					})
				)
			);

			allLegends.forEach((l) => {
				const shapes = this.legends.get(l);
				if (shapes.length > 0) {
					const scale = findBestLegendScalingFactor(face.shape, shapes);
					this.currentLegendScaling.set(l, scale); // save for later
					if (scale < smallest) {
						smallest = scale;
					}
				}
			});

			this.currentSmallestLegendScaling = smallest;
			console.log('scaling', this.model.id, {
				individualLegendScaling: this.individualLegendScaling,
				smallest: this.currentSmallestLegendScaling,
				legends: this.currentLegendScaling
			});
		}
	}

	public export(dieParams: Record<string, number>, faceParams: Array<FaceParams>) {
		// we will rebuild everything at high quality for export, we also merge the geometries and use merge vertcies
		// to ensure everything is tight.
		dieParams = simplifyDieParams(dieParams, this.model.parameters);
		const dieChanged = this.forceRerenderBlank || !dieParamsEqual(this.lastDieParams, dieParams);
		if (dieChanged) {
			const x = this.model.build(dieParams);
			this.face2face = x.faceToFaceDistance;
			this.recalculateLegendScaling();
			this.faces = x.faces;
			this.individualLegendScaling = !!x.sizeLegendsIndividually;
			this.faceObjects.forEach((g) => g.children?.forEach((c) => g.remove(c)));
			this.lastDieParams = dieParams;
		}
		this.forceRerenderBlank = false;
		const geos: Array<BufferGeometry> = [];
		for (let i = 0; i < this.faces.length; i++) {
			const face = this.faces[i];
			const newFaceParams = simplifyFaceParams(faceParams[i], face);
			// don't add these to the object.
			const f = this.buildFace(i, dieParams.engraving_depth, newFaceParams, { forExport: true });
			f.forEach((g) => {
				// geometry is built at the origin, so bake the solid transform in for
				// export (we always export in the solid/printing position).
				face.transform.applyToGeometry(g);
				// ensure we can merge them
				if (g.index) {
					g = g.toNonIndexed();
				}
				g.computeVertexNormals();
				delete g.attributes.uv;
				geos.push(g);
			});
		}
		const combined = mergeGeometries(geos);
		const merged = mergeVertices(combined);
		const deduped = removeDuplicateTriangles(merged);
		return new Mesh(deduped, _m1);
	}

	public getDefaultScaleForLegend(l: Legend): number {
		if (this.individualLegendScaling) {
			return this.currentLegendScaling.get(l) ?? this.currentSmallestLegendScaling;
		} else {
			return this.currentSmallestLegendScaling;
		}
	}

	private buildFace(
		i: number,
		engravingDepth: number,
		params: FaceParams,
		opts: { forExport: boolean } = { forExport: false }
	): Array<BufferGeometry> {
		// engrave face.
		const face = this.faces[i];
		const legend = params.legend ?? face.defaultLegend;
		const symbols = this.legends.get(legend);
		if (!params.scale) {
			params.scale = this.getDefaultScaleForLegend(legend);
		}
		let output: Array<BufferGeometry>;
		try {
			output = engrave(
				face.shape,
				symbols,
				params,
				engravingDepth + (params.extraDepth ?? 0),
				undefined, // clearance
				opts.forExport ? DefaultDivisions : 2 * DefaultDivisions // will need to "up" this to make a "high quality" render.
			);
		} catch (e) {
			console.warn(
				'error building face',
				i,
				'with symbol',
				debugLegendName(params.legend ?? face.defaultLegend)
			);
			output = engrave(
				face.shape,
				[], // force to blank
				params,
				engravingDepth + (params.extraDepth ?? 0),
				undefined, // clearance
				opts.forExport ? DefaultDivisions : 2 * DefaultDivisions // will need to "up" this to make a "high quality" render.
			);
		}

		// geometry is built at the origin; the face's Group is positioned/oriented
		// by the view layer (see applyProgress/update) so we can animate between
		// the solid and exploded states.
		return output;
	}
}

const tau = 2 * Math.PI;

function now(): number {
	return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// smooth ease-in-out (cubic) used for the explode animation.
function easeInOut(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function faceParamsNotEqual(prev: FaceParams, next: FaceParams, face: DieFaceModel) {
	const simples =
		prev.legend !== next.legend ||
		prev.scale !== next.scale ||
		prev.rotation !== next.rotation ||
		next.extraDepth !== prev.extraDepth;
	// if simples is true, something is not equal
	if (simples) {
		return true;
	}
	// offsets default to 0,0
	const prevOffset = prev.offset ?? new Vector2(0, 0);
	const nextOffset = next.offset ?? new Vector2(0, 0);
	return !prevOffset.equals(nextOffset);
}

function simplifyFaceParams(obj: FaceParams | undefined, face: DieFaceModel): FaceParams {
	const params: FaceParams = {};
	if (!obj) {
		return params;
	}
	if (obj.extraDepth) {
		params.extraDepth = obj.extraDepth;
	}
	if ('legend' in obj && obj.legend !== face.defaultLegend) {
		params.legend = obj.legend;
	}
	if (obj.offset && obj.offset.lengthSq() !== 0) {
		params.offset = obj.offset;
	}
	if (obj.rotation) {
		let r = obj.rotation;
		while (r >= tau) {
			r -= tau;
		}
		while (r < 0) {
			r += tau;
		}
		if (r !== 0) {
			params.rotation = r;
		}
	}
	if (obj.scale) {
		params.scale = obj.scale;
	}
	return params;
}

export const engravingParam: DiceParameter = {
	id: 'engraving_depth',
	defaultValue: 0.8,
	min: 0.1,
	max: 1.5,
	step: 0.01
};

function simplifyDieParams(
	obj: Record<string, number>,
	params: Array<DiceParameter>
): Record<string, number> {
	const output: Record<string, number> = {};
	params.forEach((param) => {
		if (param.id in obj) {
			const value = clampParam(obj[param.id], param);
			if (value != param.defaultValue) {
				output[param.id] = value;
			}
		}
	});

	// we also add the engraving depth.
	if ('engraving_depth' in obj) {
		const value = clampParam(obj.engraving_depth, engravingParam);
		output.engraving_depth = value;
	} else {
		output.engraving_depth = engravingParam.defaultValue;
	}
	return output;
}

function clampParam(val: number, param: DiceParameter): number {
	// limit to "step".
	val = Math.round(val / param.step) * param.step;
	if (val < param.min) {
		val = param.min;
	}
	if (val > param.max) {
		val = param.max;
	}
	return val;
}

function dieParamsEqual(prev: Record<string, number>, next: Record<string, number>): boolean {
	const pk = Object.keys(prev);
	const nk = Object.keys(next);
	if (pk.length !== nk.length) {
		return false;
	}
	for (let i = 0; i < pk.length; i++) {
		const k = pk[i];
		if (prev[k] !== next[k]) {
			return false;
		}
	}
	return true;
}
