import type { DiceParameter, DieFaceModel, DieModel, FaceParams } from '$lib/interfaces/dice';
import {
	BufferGeometry,
	Group,
	Material,
	Mesh,
	MeshBasicMaterial,
	MeshNormalMaterial,
	Vector3,
	Plane,
	type Object3D,
	Vector2
} from 'three';
import { DefaultDivisions, engrave, Part } from './engraving';
import { debugLegendName, Legend, type LegendSet } from './legends';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { removeDuplicateTriangles } from './bad_edges';
import { findBestLegendScalingFactor, getAreaOfShapeAtOrigin } from './shapes';
import { uuid } from './uuid';

const _m1 = new MeshNormalMaterial({ wireframe: !true });
const _m2 = new MeshBasicMaterial({ color: 0x000000 });
const _m3 = new MeshBasicMaterial({ color: 0xff0000 });

export class Builder {
	private forceRerenderBlank = true;
	private forceRerenderFaces = true;
	private lastDieParams: Record<string, number> = {};
	private face2face: number = 0;
	public currentLegendScaling: number = 1;
	private faces: Array<DieFaceModel> = [];
	private faceObjects: Array<Object3D> = [];
	private lastFaceParams: Array<FaceParams> = [];
	private engravingDepth: number = 0.8;

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
	) {}

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
		const volume = this.faces.reduce((sum, f, i) => {
			const area = getAreaOfShapeAtOrigin(f.shape);
			const obj = this.faceObjects[i].children.find((m) => {
				return (m as Mesh).isMesh && m.userData.diceThingPart === Part.Front;
			}) as Mesh;
			const position = obj.geometry.getAttribute('position');
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

	build(dieParams: Record<string, number>, faceParams: Array<FaceParams>) {
		dieParams = simplifyDieParams(dieParams, this.model.parameters);
		const dieChanged = this.forceRerenderBlank || !dieParamsEqual(this.lastDieParams, dieParams);
		if (dieChanged) {
			const x = this.model.build(dieParams);
			this.face2face = x.faceToFaceDistance;
			this.faces = x.faces;
			this.recalculateLegendScaling();
			this.diceGroup.remove(...this.faceObjects);
			this.faceObjects.length = 0;
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
				if (this.faceObjects[i]) {
					this.diceGroup.remove(this.faceObjects[i]);
				}
				this.lastFaceParams[i] = newFaceParams;
				this.faceObjects[i] = new Group();
				this.buildFace(i, dieParams.engraving_depth, newFaceParams, false).forEach((g) => {
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
				this.diceGroup.add(this.faceObjects[i]);
			}
		}
		this.forceRerenderBlank = false;
		this.forceRerenderFaces = false;
	}

	private recalculateLegendScaling() {
		let scaling = 1;
		const face = this.faces.find((x) => x.isNumberFace);
		if (face) {
			const shapes = this.legends.get(Legend.DOUBLE_ZERO); // probably the widest/squarest shape.
			if (shapes.length > 0) {
				// we have a face and a non-blank symbol.
				scaling = findBestLegendScalingFactor(face.shape, shapes);
			}
		}
		this.currentLegendScaling = scaling;
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
			this.faceObjects.length = 0;
			this.lastDieParams = dieParams;
		}
		this.forceRerenderBlank = false;
		const geos: Array<BufferGeometry> = [];
		for (let i = 0; i < this.faces.length; i++) {
			const newFaceParams = simplifyFaceParams(faceParams[i], this.faces[i]);
			// don't add these to the object.
			const f = this.buildFace(i, dieParams.engraving_depth, newFaceParams, true);
			f.forEach((g) => {
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

	private buildFace(
		i: number,
		engravingDepth: number,
		params: FaceParams,
		forExport = false
	): Array<BufferGeometry> {
		// engrave face.
		const face = this.faces[i];
		const legend = this.legends.get(params.legend ?? face.defaultLegend);
		if (!params.scale) {
			params.scale = this.currentLegendScaling;
		}
		let output: Array<BufferGeometry>;
		try {
			output = engrave(
				face.shape,
				legend,
				params,
				engravingDepth + (params.extraDepth ?? 0),
				forExport ? DefaultDivisions : 2 * DefaultDivisions // will need to "up" this to make a "high quality" render.
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
				forExport ? DefaultDivisions : 2 * DefaultDivisions // will need to "up" this to make a "high quality" render.
			);
		}
		output.forEach((g) => face.orient(g));
		return output;
	}
}

const tau = 2 * Math.PI;

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
