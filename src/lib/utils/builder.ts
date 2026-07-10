import type {
	DiceParameter,
	DieFaceModel,
	DieModel,
	FaceParams,
	StringParameter
} from '$lib/interfaces/dice';
import {
	BufferGeometry,
	Float32BufferAttribute,
	Group,
	LineBasicMaterial,
	LineLoop,
	Material,
	Matrix4,
	Mesh,
	MeshBasicMaterial,
	MeshNormalMaterial,
	Quaternion,
	Shape,
	ShapeGeometry,
	Vector3,
	type Object3D,
	Vector2,
	DoubleSide
} from 'three';
import { DefaultDivisions, Part } from './engraving';
import {
	buildBlankFaceCapGeometry,
	buildEngravedDieExport,
	canEngraveLegend,
	engraveFace,
	extractFaceGeometry,
	getOrBuildBlankManifold,
	insetShapeViaCrossSection,
	manifoldDieToGeometry,
	transformToMat4
} from './die_manifold';
import type { Manifold } from './manifold';
import { manifold } from './manifold';
import { debugLegendName, Legend, type LegendSet } from './legends';
import { applyOrderingToFaces, STANDARD_ORDERING } from '$lib/utils/legend_orderings';

// A single face whose legend cannot be engraved (i.e. would cause export to
// produce a blank/broken face). `reason` distinguishes a symbol that is simply
// too large to fit the face from a hard failure during engraving.
export type EngravingError = {
	faceIndex: number;
	legend: Legend;
	// human-readable legend name, resolved against the builder's legend set.
	legendName: string;
	reason: 'symbol-too-large' | 'build-failed';
};
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { removeDuplicateTriangles, repairDegenerateTriangles } from './bad_edges';
import { findBestLegendScalingFactor, insetPolygon } from './shapes';
import { uuid } from './uuid';
import { toNonIndexed, Transform } from './3d';

const _genericNormalMaterial = new MeshNormalMaterial({ wireframe: !true });
const _engraveBackMaterial = new MeshBasicMaterial({ color: 0x666666 });
const _badElementMaterial = new MeshBasicMaterial({ color: 0xff0000, side: DoubleSide });
// outline of the available legend area (face fit-shape inset by the tolerance).
// a thin line drawn over the face (depthTest off) in a vivid colour. it stays
// crisp; the prominence comes from the pulsing-glow highlight pass driven by the
// invisible fill below.
const _legendAreaMaterial = new LineBasicMaterial({
	color: 0x00cc00,
	depthTest: false,
	transparent: true
});
// red variant used when the face's legend won't engrave cleanly (too large /
// build failure), so the area aid doubles as a fit warning.
const _legendAreaErrorMaterial = new LineBasicMaterial({
	color: 0xff2d2d,
	depthTest: false,
	transparent: true
});
// invisible filled polygon matching the legend area. it is never drawn in the
// beauty pass (colorWrite off) and never occludes the die (depthWrite off); it
// exists purely as the source object for the pulsing-glow OutlinePass, which
// outlines its silhouette to highlight the legend area. lines can't be used as
// OutlinePass sources (the pass hides all lines for its mask), hence the fill.
const _legendAreaGlowMaterial = new MeshBasicMaterial({
	colorWrite: false,
	depthWrite: false,
	depthTest: false
});
// userData.diceThingPart markers for the legend-area aids so they can be found,
// removed, and excluded from hover/selection raycasting. both share the
// 'legend-area' prefix so the wireframe pass can skip them in one check.
const LEGEND_AREA_PART = 'legend-area';
const LEGEND_AREA_GLOW_PART = 'legend-area-glow';
// glow fill for faces whose engraving is "bad"; fed into a separate red glow
// pass. note it keeps the 'legend-area-glow' prefix so the scene's per-pass
// glow-hiding still matches it.
const LEGEND_AREA_GLOW_ERROR_PART = 'legend-area-glow-error';

const _va = new Vector3();
const _vb = new Vector3();
const _vc = new Vector3();
const _cross = new Vector3();

// Approximate solid volume (mm³) of a die described by its face models, ignoring
// any engraving ("without legends"). Every die here is built centred on, and
// star-shaped about, the origin (the centre "sees" every face), so the solid is
// the union of the pyramids from the origin out to each face. We sum each face's
// pyramid volume: fan-triangulate the (origin-built) 2D shape, lift it into the
// assembled (un-exploded) position, and add the absolute tetrahedron volume
// (origin, a, b, c) of each fan triangle.
//
// A signed fan sum is taken per face and only then made positive: within one
// planar face every fan triangle's tetra volume shares the same sign (the origin
// is on one side of the face's plane), so the signed sum equals ±(pyramid
// volume) and stays correct for a concave face (e.g. a custom coin outline),
// where the signed triangle areas cancel to the true polygon area. Summing the
// signed values across faces instead would be wrong: the raw 2D shapes are not
// wound consistently outward, so opposite-facing faces (e.g. the coin's caps vs
// its rim facets) would cancel.
export function approximateDieVolume(faces: Array<DieFaceModel>): number {
	let v6 = 0;
	for (const face of faces) {
		const pts = face.shape.getPoints();
		if (pts.length < 3) {
			continue;
		}
		const world = pts.map((p) => face.transform.applyToVector3(new Vector3(p.x, p.y, 0)));
		let faceV6 = 0;
		for (let i = 1; i < world.length - 1; i++) {
			_va.copy(world[0]);
			_vb.copy(world[i]);
			_vc.copy(world[i + 1]);
			faceV6 += _va.dot(_cross.crossVectors(_vb, _vc));
		}
		v6 += Math.abs(faceV6);
	}
	return v6 / 6;
}

// Enclosed volume (mm³) of a closed mesh, computed from its triangle soup as the
// sum of signed tetrahedron volumes (origin, a, b, c). For a closed surface this
// is translation-invariant (divergence theorem), so it is valid even on meshes
// that have been laid out (translated) for preview/export. Unlike
// approximateDieVolume this measures whatever the mesh actually contains (e.g. a
// platform pedestal, or a blank that includes the die's true non-convex shape).
export function meshVolume(mesh: Mesh): number {
	const pos = toNonIndexed(mesh.geometry).getAttribute('position');
	let v6 = 0;
	for (let i = 0; i < pos.count; i += 3) {
		_va.set(pos.getX(i), pos.getY(i), pos.getZ(i));
		_vb.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
		_vc.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
		v6 += _va.dot(_cross.crossVectors(_vb, _vc));
	}
	return Math.abs(v6) / 6;
}

export class Builder {
	private renderCount = 0;
	private forceRerenderBlank = true;
	private forceRerenderFaces = true;
	private lastDieParams: Record<string, number> = {};
	private lastStringParams: Record<string, string> = {};
	// the legend ordering applied to the last build/export. tracked so a change
	// of ordering (with otherwise-unchanged die params) still re-derives the
	// per-face default legends and forces the faces to re-engrave.
	private lastOrdering: string = STANDARD_ORDERING;
	private face2face: number = 0;
	private individualLegendScaling = false;
	public currentSmallestLegendScaling: number = 1;
	public readonly currentLegendScaling = new Map<Legend, number>();
	// minimum legend inset from the face edge for the last build/export. fed into
	// engrave() as the clearance and into the legend auto-scaling.
	private currentTolerance: number = engravingToleranceParam.defaultValue;
	// when true, each number face carries an outline of the available legend area
	// (its fit-shape inset by the tolerance) as a design aid in the editor.
	private showLegendArea = false;
	private faces: Array<DieFaceModel> = [];
	private faceObjects: Array<Object3D> = [];
	private lastFaceParams: Array<FaceParams> = [];

	// per-face engraving error (or null when the face engraves cleanly). updated
	// every time a face is (re)built, in both the preview build() and export()
	// paths. exposed via getEngravingErrors() so the UI can warn about dice that
	// would export broken.
	private faceEngravingErrors: Array<EngravingError | null> = [];

	// orientation/raise to apply when exporting for print. defaults to identity
	// (a no-op) until each die model provides one. the future "drop to build
	// plate" work hooks in here.
	private printingTransform: Transform = new Transform();

	// optional extra rotation for the preview camera (see DieModel.build). when a
	// model provides one the previewer tilts off the head-on face view so flat
	// dice still read as 3D objects. undefined => look straight at the face.
	private previewTransform: Transform | undefined;

	// per-face solid ("n") and exploded ("e") target transforms, decomposed into
	// position + quaternion so the view layer can interpolate between them.
	private faceTransforms: Array<{
		nPos: Vector3;
		nQuat: Quaternion;
		ePos: Vector3;
		eQuat: Quaternion;
	}> = [];

	// hidden faces (e.g. the coin's many rim/bevel segments) are merged into a
	// single group and animated as one rigid body, rather than animating hundreds
	// of individual face groups every frame (which tanked the explode animation
	// and the fancy renderer). they fly straight down and behind the camera.
	private hiddenGroup: Group | undefined;
	private hiddenAnim: { nPos: Vector3; ePos: Vector3 } | undefined;
	// where the merged hidden-face clump travels to when exploded: down and back
	// behind the explode-view camera (which sits at z = 100 looking at origin).
	private static readonly HIDDEN_EXPLODE_OFFSET = new Vector3(0, -250, 120);

	// animation state. progress goes 0 (solid) -> 1 (exploded).
	private exploded = false;
	private progress = 0;
	private targetProgress = 0;
	private lastAnimTime = 0;
	private hasBuilt = false;
	private static readonly EXPLODE_DURATION_MS = 800;

	// Manifold cross-section subtract engraving (production default).
	public useManifoldEngraving = true;

	// Cached blank export geometry for manifold blank builds (invalidated on die change).
	private cachedBlankExportGeometry: BufferGeometry | undefined;
	private cachedBlankExportKey = '';
	private buildingBlankExport = false;
	// Retained from the last export() for direct 3MF output; taken via takeExportManifold().
	private exportManifold: Manifold | undefined;

	private frontMaterial: Material = _genericNormalMaterial;
	private wallMaterial: Material = _genericNormalMaterial;

	// this to a flat grey
	private engraveMaterial: Material = _engraveBackMaterial;
	private errorMaterial: Material = _badElementMaterial;

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

	// Faces (with their legends) that could not be engraved as of the last
	// build()/export(). An empty array means the die engraves cleanly. Hidden
	// faces are always blank and never contribute errors.
	public getEngravingErrors(): Array<EngravingError> {
		return this.faceEngravingErrors.filter((e): e is EngravingError => e !== null);
	}

	// the model's optional preview-camera tweak, available after build(). used by
	// the previewer to nudge the thumbnail view off the head-on face axis.
	public getPreviewTransform(): Transform | undefined {
		return this.previewTransform;
	}

	// Toggle the available-legend-area outline on every (number) face. The outline
	// is the face's convex fit-shape inset by the current engraving tolerance.
	setLegendAreaVisible(on: boolean) {
		if (this.showLegendArea === on) {
			return;
		}
		this.showLegendArea = on;
		for (let i = 0; i < this.faceObjects.length; i++) {
			if (this.faceObjects[i]) {
				this.refreshLegendAreaOutline(i);
			}
		}
	}

	// (re)build the legend-area aids on a face group. Removes any existing ones
	// first, then adds a fresh thin outline loop plus an invisible fill (the
	// source for the pulsing-glow highlight pass) when enabled. Both are built at
	// the origin so they animate with the face group (a child of faceObjects[i]).
	private refreshLegendAreaOutline(i: number) {
		const group = this.faceObjects[i];
		if (!group) {
			return;
		}
		const existing = group.children.filter((c) => {
			const part = c.userData?.diceThingPart;
			return typeof part === 'string' && part.startsWith(LEGEND_AREA_PART);
		});
		group.remove(...existing);
		existing.forEach((c) => (c as Mesh | LineLoop).geometry?.dispose());
		const face = this.faces[i];
		if (!this.showLegendArea || !face || face.hidden) {
			return;
		}
		// show on every number face, and on a non-number ("blank") face only when it
		// actually carries a legend (a non-blank glyph has been placed on it).
		const effectiveLegend = this.lastFaceParams[i]?.legend ?? face.defaultLegend;
		if (!face.isNumberFace && effectiveLegend === Legend.BLANK) {
			return;
		}
		// the inset of the face shape by the tolerance. a concave face can inset to
		// more than one loop (or none), so this returns a list of loops.
		let loops: Array<Array<Vector2>>;
		try {
			const csLoop = insetShapeViaCrossSection(
				face.shape,
				this.currentTolerance,
				DefaultDivisions
			);
			loops = csLoop ? [csLoop] : [];
		} catch {
			loops = insetPolygon(face.shape, this.currentTolerance, face.convex !== false);
		}
		if (loops.length === 0) {
			loops = insetPolygon(face.shape, this.currentTolerance, face.convex !== false);
		}
		if (loops.length === 0) {
			return;
		}
		// lift slightly off the face surface so it doesn't z-fight with the front.
		const z = 0.12;

		// faces whose legend won't engrave cleanly get the red variant so the area
		// aid doubles as a fit warning.
		const hasError = !!this.faceEngravingErrors[i];

		for (const pts of loops) {
			if (pts.length < 3) {
				continue;
			}
			// thin outline drawn as a closed loop.
			const positions = new Float32Array(pts.length * 3);
			for (let k = 0; k < pts.length; k++) {
				positions[k * 3] = pts[k].x;
				positions[k * 3 + 1] = pts[k].y;
				positions[k * 3 + 2] = z;
			}
			const lineGeo = new BufferGeometry();
			lineGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
			const line = new LineLoop(lineGeo, hasError ? _legendAreaErrorMaterial : _legendAreaMaterial);
			// always draw the outline on top of the die.
			line.renderOrder = 999;
			line.userData.diceThingPart = LEGEND_AREA_PART;
			line.userData.diceThingFace = i;
			line.userData.diceThingId = this.id;
			// never pick the outline when hovering/selecting faces.
			line.raycast = () => {};
			group.add(line);

			// invisible filled polygon: the silhouette source for the glow pass.
			// tagged by error state so the matching (lime or red) glow pass picks it up.
			const glowGeo = new ShapeGeometry(new Shape(pts));
			glowGeo.translate(0, 0, z);
			const glow = new Mesh(glowGeo, _legendAreaGlowMaterial);
			glow.userData.diceThingPart = hasError ? LEGEND_AREA_GLOW_ERROR_PART : LEGEND_AREA_GLOW_PART;
			glow.userData.diceThingFace = i;
			glow.userData.diceThingId = this.id;
			glow.raycast = () => {};
			group.add(glow);
		}
	}

	private collectGlowObjects(part: string): Array<Object3D> {
		const objs: Array<Object3D> = [];
		for (const group of this.faceObjects) {
			group?.children.forEach((c) => {
				if (c.userData?.diceThingPart === part) {
					objs.push(c);
				}
			});
		}
		return objs;
	}

	// invisible filled polygons used as the source for the pulsing-glow highlight
	// pass. only present while the legend area is visible. the error variant feeds
	// the separate red glow pass for faces that won't engrave cleanly.
	getLegendAreaGlowObjects(): Array<Object3D> {
		return this.collectGlowObjects(LEGEND_AREA_GLOW_PART);
	}

	getLegendAreaGlowErrorObjects(): Array<Object3D> {
		return this.collectGlowObjects(LEGEND_AREA_GLOW_ERROR_PART);
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

	// Approximate solid volume (mm³) of the die, ignoring any engraving ("without
	// legends"). Only depends on the die parameters (the face geometry), not the
	// per-face legends.
	public getApproximateVolume(): number {
		return approximateDieVolume(this.faces);
	}

	getFace2FaceDistance(): number {
		return this.face2face;
	}

	getBlankExportShell(dieParams: Record<string, number>): BufferGeometry {
		return this.blankExportGeometry(dieParams);
	}

	takeExportManifold(): Manifold | undefined {
		const man = this.exportManifold;
		this.exportManifold = undefined;
		return man;
	}

	getLastDieParams(): Record<string, number> {
		return this.lastDieParams;
	}

	getLastStringParams(): Record<string, string> {
		return this.lastStringParams;
	}

	applyPrintingTransformToGeometry(geometry: BufferGeometry): void {
		this.printingTransform.applyToGeometry(geometry);
	}

	changeLegends(set: LegendSet) {
		if (set.id === this.legends.id) {
			return;
		}
		this.legends = set;
		this.recalculateLegendScaling();
		this.forceRerenderFaces = true;
	}

	// Force-adopt a legend set even when the id is unchanged. Used when the
	// *contents* of a custom legend set have been edited (same id, new shapes).
	reloadLegends(set: LegendSet) {
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

	// Swap the front + wall materials to a "fancy" PBR material, or back to the
	// default normal material when undefined. Engraved/symbol parts are left
	// alone (engravings stay inked). Stored so future rebuilds keep the choice,
	// and applied to the meshes already in the scene via a traverse (the face
	// meshes live nested inside per-face groups).
	setFancy(mat?: Material) {
		this.frontMaterial = mat ?? _genericNormalMaterial;
		this.wallMaterial = mat ?? _genericNormalMaterial;
		this.diceGroup.traverse((o) => {
			const mesh = o as Mesh;
			if (!mesh.isMesh) {
				return;
			}
			if (mesh.userData.diceThingPart === Part.Front) {
				mesh.material = this.frontMaterial;
			} else if (mesh.userData.diceThingPart === Part.Walls) {
				mesh.material = this.wallMaterial;
			}
		});
	}

	build(
		dieParams: Record<string, number>,
		faceParams: Array<FaceParams>,
		opts: { explode: boolean; ordering?: string } = { explode: true },
		stringParams: Record<string, string> = {}
	): number {
		dieParams = simplifyDieParams(dieParams, this.model.parameters);
		stringParams = simplifyStringParams(stringParams, this.model.stringParameters);
		const ordering = opts.ordering ?? STANDARD_ORDERING;
		this.currentTolerance = dieParams.engraving_tolerance;
		// an ordering change is treated like a die change: the model is rebuilt so
		// the number faces start from their standard defaults, and the new ordering
		// is then re-applied on top (applyOrderingToFaces only overrides, it can't
		// undo a previous ordering's overrides on its own).
		const dieChanged =
			this.forceRerenderBlank ||
			ordering !== this.lastOrdering ||
			!dieParamsEqual(this.lastDieParams, dieParams) ||
			!stringParamsEqual(this.lastStringParams, stringParams);
		if (dieChanged) {
			const x = this.model.build(dieParams, stringParams);
			this.face2face = x.faceToFaceDistance;
			this.faces = x.faces;
			this.individualLegendScaling = !!x.sizeLegendsIndividually;
			this.previewTransform = x.previewTransform;
			// keep the print orientation in sync with the current die params here
			// too: a build option (e.g. blanks) builds a builder then re-exports it
			// with the SAME params, so export()'s dieChanged guard would otherwise
			// skip recomputing this and the artifact would export un-oriented.
			this.printingTransform = x.printingTransform ?? new Transform();
			// the ordering rewrites the number faces' default legends, and the
			// legend scaling reads those, so apply it before recalculating.
			applyOrderingToFaces(this.model.id, ordering, this.faces, dieParams);
			this.recalculateLegendScaling();
			this.computeFaceTransforms();
			this.lastDieParams = dieParams;
			this.lastStringParams = stringParams;
			this.lastOrdering = ordering;
			// the new blank may have fewer faces than the last one (e.g. lowering
			// the coin's segment count). drop any leftover face groups so their
			// stale geometry doesn't linger in the scene.
			this.pruneFaceObjects(this.faces.length);
			// (re)build the merged clump of hidden faces. these never depend on
			// face params (they're always blank), so only the blank changing matters.
			this.rebuildHiddenClump(dieParams.engraving_depth);
		}
		for (let i = 0; i < this.faces.length; i++) {
			// hidden faces are handled by the merged clump above; make sure no stale
			// individual group lingers for this index, then skip it.
			if (this.faces[i].hidden) {
				this.removeFaceObject(i);
				continue;
			}
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
				this.buildFace(i, dieParams.engraving_depth, newFaceParams, { forExport: false }).forEach(
					(g) => {
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
					}
				);
				this.refreshLegendAreaOutline(i);
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

	// remove face groups at indices >= keep, detaching them from the scene and
	// disposing their geometries. used when a rebuild produces fewer faces than
	// the previous one so old geometry isn't left floating in the diceGroup.
	private pruneFaceObjects(keep: number) {
		if (this.faceObjects.length <= keep) {
			return;
		}
		for (let i = keep; i < this.faceObjects.length; i++) {
			const g = this.faceObjects[i];
			if (!g) {
				continue;
			}
			g.traverse((o) => {
				const mesh = o as Mesh;
				if (mesh.isMesh) {
					mesh.geometry?.dispose();
				}
			});
			this.diceGroup.remove(g);
		}
		this.faceObjects.length = keep;
		this.lastFaceParams.length = keep;
		this.faceEngravingErrors.length = keep;
	}

	// detach and dispose the individual animated group for face `i` (if any). used
	// when a face becomes hidden (handled by the merged clump instead).
	private removeFaceObject(i: number) {
		const g = this.faceObjects[i];
		if (!g) {
			return;
		}
		g.traverse((o) => {
			const mesh = o as Mesh;
			if (mesh.isMesh) {
				mesh.geometry?.dispose();
			}
		});
		this.diceGroup.remove(g);
		this.faceObjects[i] = undefined as unknown as Object3D;
		this.lastFaceParams[i] = {};
		// a hidden face is blank, so it can never carry an engraving error.
		this.faceEngravingErrors[i] = null;
	}

	// Merge every hidden face into one geometry under a single group, with each
	// face's solid transform baked in. Animating this one group (instead of the
	// hundreds of individual rim-segment groups a high-segment / custom coin
	// produces) keeps the explode animation cheap, and the single merged mesh
	// keeps the (fancy) renderer's draw-call count low.
	private rebuildHiddenClump(engravingDepth: number) {
		if (this.hiddenGroup) {
			this.hiddenGroup.traverse((o) => {
				const mesh = o as Mesh;
				if (mesh.isMesh) {
					mesh.geometry?.dispose();
				}
			});
			this.diceGroup.remove(this.hiddenGroup);
			this.hiddenGroup = undefined;
			this.hiddenAnim = undefined;
		}
		const geos: Array<BufferGeometry> = [];
		for (let i = 0; i < this.faces.length; i++) {
			const face = this.faces[i];
			if (!face.hidden) {
				continue;
			}
			// hidden faces are always blank, so build with empty params and bake the
			// face's solid transform into the geometry (the clump group is the thing
			// that animates).
			this.buildFace(i, engravingDepth, {}, { forExport: false }).forEach((g) => {
				face.transform.applyToGeometry(g);
				geos.push(g);
			});
		}
		if (geos.length === 0) {
			return;
		}
		const group = new Group();
		// note: the clump is deliberately NOT tagged with `diceThingId`, so the
		// raycaster (see events.ts) ignores it: the rim is not a selectable face.
		// it keeps `diceThingPart: Part.Front` so material/fancy swaps still apply.
		// hidden faces are blank, so every part is a Front cap with the same
		// material; merge into one mesh. fall back to separate meshes if the
		// geometries can't be merged for some reason.
		let merged: BufferGeometry | null = null;
		try {
			merged = mergeGeometries(geos);
		} catch {
			merged = null;
		}
		if (merged) {
			geos.forEach((g) => g.dispose());
			const mesh = new Mesh(merged, this.frontMaterial);
			mesh.userData = { diceThingPart: Part.Front };
			group.add(mesh);
		} else {
			geos.forEach((g) => {
				const mesh = new Mesh(g, this.frontMaterial);
				mesh.userData = { diceThingPart: Part.Front };
				group.add(mesh);
			});
		}
		this.diceGroup.add(group);
		this.hiddenGroup = group;
		this.hiddenAnim = {
			nPos: new Vector3(0, 0, 0),
			ePos: Builder.HIDDEN_EXPLODE_OFFSET.clone()
		};
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
		// the merged hidden-face clump moves as a single rigid body (translation
		// only), so one lerp animates all of it.
		if (this.hiddenGroup && this.hiddenAnim) {
			this.hiddenGroup.position.lerpVectors(this.hiddenAnim.nPos, this.hiddenAnim.ePos, eased);
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

			// fit against the face shape; a concave face (custom coin outline) uses
			// the general containment maths so the whole outline is usable.
			const convex = face.convex !== false;
			allLegends.forEach((l) => {
				const shapes = this.legends.get(l);
				if (shapes.length > 0) {
					const scale = findBestLegendScalingFactor(
						face.shape,
						shapes,
						this.currentTolerance,
						convex
					);
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

	public export(
		dieParams: Record<string, number>,
		faceParams: Array<FaceParams>,
		stringParams: Record<string, string> = {},
		ordering: string = STANDARD_ORDERING
	) {
		// we will rebuild everything at high quality for export, we also merge the geometries and use merge vertcies
		// to ensure everything is tight.
		dieParams = simplifyDieParams(dieParams, this.model.parameters);
		stringParams = simplifyStringParams(stringParams, this.model.stringParameters);
		this.currentTolerance = dieParams.engraving_tolerance;
		const orderingChanged = ordering !== this.lastOrdering;
		const dieChanged =
			this.forceRerenderBlank ||
			orderingChanged ||
			!dieParamsEqual(this.lastDieParams, dieParams) ||
			!stringParamsEqual(this.lastStringParams, stringParams);
		if (dieChanged) {
			const x = this.model.build(dieParams, stringParams);
			this.face2face = x.faceToFaceDistance;
			// NOTE: faces + individualLegendScaling must be set BEFORE recalculating
			// the legend scaling, otherwise (on a freshly-built builder) no number
			// face is found, glyphs stay at scale 1, overflow small faces and fail to
			// engrave -> they silently fall back to blank (notably on the d20).
			this.faces = x.faces;
			this.individualLegendScaling = !!x.sizeLegendsIndividually;
			// the ordering rewrites the number faces' default legends; apply it
			// before scaling (which reads those defaults).
			applyOrderingToFaces(this.model.id, ordering, this.faces, dieParams);
			this.lastOrdering = ordering;
			this.recalculateLegendScaling();
			// most dice omit this today; default to identity so export still works.
			this.printingTransform = x.printingTransform ?? new Transform();
			this.faceObjects.forEach((g) => g.children?.forEach((c) => g.remove(c)));
			// drop any stale per-face errors from a previous (larger) blank; the loop
			// below repopulates index 0..faces.length-1.
			this.faceEngravingErrors.length = this.faces.length;
			this.lastDieParams = dieParams;
			this.lastStringParams = stringParams;
			this.cachedBlankExportGeometry?.dispose();
			this.cachedBlankExportGeometry = undefined;
			this.cachedBlankExportKey = '';
		}
		this.forceRerenderBlank = false;
		if (this.useManifoldEngraving) {
			return this.exportViaManifold(dieParams, faceParams);
		}
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
				g = toNonIndexed(g);
				g.computeVertexNormals();
				delete g.attributes.uv;
				geos.push(g);
			});
		}
		const repaired = assembleExportSolid(geos);
		// bake the model's print orientation/raise in last (identity for now).
		this.printingTransform.applyToGeometry(repaired);
		return new Mesh(repaired, _genericNormalMaterial);
	}

	private blankExportGeometry(dieParams: Record<string, number>): BufferGeometry {
		const key = JSON.stringify(dieParams);
		if (this.cachedBlankExportGeometry && this.cachedBlankExportKey === key) {
			return this.cachedBlankExportGeometry;
		}
		const geos: Array<BufferGeometry> = [];
		this.buildingBlankExport = true;
		try {
			for (let i = 0; i < this.faces.length; i++) {
				const face = this.faces[i];
				const g = buildBlankFaceCapGeometry(face, DefaultDivisions);
				face.transform.applyToGeometry(g);
				const ng = toNonIndexed(g);
				ng.computeVertexNormals();
				delete ng.attributes.uv;
				g.dispose();
				geos.push(ng);
			}
		} finally {
			this.buildingBlankExport = false;
		}
		const repaired = assembleExportSolid(geos);
		this.cachedBlankExportGeometry?.dispose();
		this.cachedBlankExportGeometry = repaired;
		this.cachedBlankExportKey = key;
		return repaired;
	}

	private exportViaManifold(
		dieParams: Record<string, number>,
		faceParams: Array<FaceParams>
	): Mesh {
		const blankGeo = this.blankExportGeometry(dieParams);
		const simplified = this.faces.map((face, i) =>
			simplifyFaceParams(faceParams[i], face)
		);
		const exported = buildEngravedDieExport({
			model: this.model,
			legends: this.legends,
			params: dieParams,
			stringParams: this.lastStringParams,
			faceParams: simplified,
			depth: dieParams.engraving_depth,
			tolerance: this.currentTolerance,
			divisions: DefaultDivisions,
			getScaleForLegend: (l) => this.getDefaultScaleForLegend(l),
			blankExportGeometry: blankGeo
		});
		this.exportManifold?.delete();
		this.exportManifold = exported.manifold;
		this.printingTransform.applyToGeometry(exported.previewMesh.geometry);
		exported.previewMesh.material = _genericNormalMaterial;
		return exported.previewMesh;
	}

	private geometryToFaceLocal(geo: BufferGeometry, face: DieFaceModel): BufferGeometry {
		const inv = new Matrix4().fromArray(transformToMat4(face.transform)).invert();
		const local = geo.clone();
		local.applyMatrix4(inv);
		return local;
	}

	private buildFaceManifold(
		i: number,
		engravingDepth: number,
		params: FaceParams,
		opts: { forExport: boolean }
	): Array<BufferGeometry> {
		const face = this.faces[i];
		const legend = params.legend ?? face.defaultLegend;
		const symbols = this.legends.get(legend);
		if (!params.scale) {
			params.scale = this.getDefaultScaleForLegend(legend);
		}
		let error: EngravingError | null = null;
		const depth = engravingDepth + (params.extraDepth ?? 0);
		const divisions = opts.forExport ? DefaultDivisions : 2 * DefaultDivisions;

		if (
			legend !== Legend.BLANK &&
			!canEngraveLegend(face.shape, symbols, params, this.currentTolerance, face.convex !== false)
		) {
			error = {
				faceIndex: i,
				legend,
				legendName: this.legends.getLegendName(legend),
				reason: 'symbol-too-large'
			};
		}
		this.faceEngravingErrors[i] = error;

		const dieParams = {
			...this.lastDieParams,
			engraving_depth: engravingDepth,
			engraving_tolerance: this.currentTolerance
		};
		const blankGeo = this.blankExportGeometry(dieParams);
		const blank = getOrBuildBlankManifold(
			this.model.id,
			this.faces,
			dieParams,
			this.lastStringParams,
			{ source: 'export', exportGeometry: blankGeo }
		);

		let man;
		if (legend === Legend.BLANK || error) {
			const wasm = manifold();
			man = new wasm.Manifold(blank.manifold.getMesh());
		} else {
			man = engraveFace(blank, face, i, symbols, params, depth, divisions);
		}
		blank.manifold.delete();

		let parts = extractFaceGeometry(man, face, i, depth);
		man.delete();

		if (!opts.forExport) {
			parts = parts.map((g) => this.geometryToFaceLocal(g, face));
		} else {
			parts = parts.map((g) => {
				const ng = toNonIndexed(g);
				ng.computeVertexNormals();
				delete ng.attributes.uv;
				g.dispose();
				return ng;
			});
		}

		if (parts.length === 0) {
			console.warn(`extractFaceGeometry returned nothing for face ${i}`);
		}
		return parts;
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
		return this.buildFaceManifold(i, engravingDepth, params, opts);
	}
}

// Combine the per-face geometries of a die into the final, print-ready solid:
// concatenate, weld coincident corners (mergeVertices), drop duplicate
// triangles, then heal T-junctions / drop zero-area slivers. This is the exact
// tail of export() factored out so the engraving audit (engraving_audit.ts) can
// assemble a solid through the identical pipeline - the repair stage in
// particular is where most manifold regressions live, so the audit must run it.
// Input geometries must be non-indexed with consistent attributes.
export function assembleExportSolid(geos: Array<BufferGeometry>): BufferGeometry {
	const combined = mergeGeometries(geos);
	const merged = mergeVertices(combined);
	const deduped = removeDuplicateTriangles(merged);
	return repairDegenerateTriangles(deduped);
}

// The structural shape of a stored `Dice` that the engraving check needs, kept
// local so this module stays decoupled from storage.
type EngravingCheckDie = {
	parameters: Record<string, number>;
	face_parameters: Array<FaceParams>;
	string_parameters?: Record<string, string>;
	legend_ordering?: string;
};

// Discover a die's engraving errors using an EXISTING builder. Callers that keep
// a per-die builder around (the editor) should use this so they don't
// reinstantiate and rebuild every die on every edit; the builder's own
// change-detection then skips faces whose params didn't actually change.
export function engravingErrorsForBuilder(
	builder: Builder,
	die: EngravingCheckDie
): Array<EngravingError> {
	try {
		builder.build(
			die.parameters,
			die.face_parameters,
			{ explode: false, ordering: die.legend_ordering },
			die.string_parameters ?? {}
		);
		return builder.getEngravingErrors();
	} catch (e) {
		console.warn('failed to compute engraving errors', e);
		return [];
	}
}

// Build a die in isolation purely to discover its engraving errors, without
// touching any scene. Used by the builder/export pages to warn about (and
// default-exclude) dice whose legends won't engrave.
export function computeEngravingErrors(
	model: DieModel,
	legends: LegendSet,
	die: EngravingCheckDie
): Array<EngravingError> {
	return engravingErrorsForBuilder(new Builder(model, legends), die);
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

// minimum distance a legend must be inset from a face edge. Threaded into
// engrave() as the `clearance` and into legend auto-scaling so legends shrink to
// honor the inset. Like engraving_depth it is not part of any DieModel's params;
// it's appended to every die and always preserved by simplifyDieParams.
export const engravingToleranceParam: DiceParameter = {
	id: 'engraving_tolerance',
	defaultValue: 0.5,
	min: 0,
	max: 3,
	step: 0.05
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
	// and the engraving tolerance (always preserved, like depth).
	if ('engraving_tolerance' in obj) {
		output.engraving_tolerance = clampParam(obj.engraving_tolerance, engravingToleranceParam);
	} else {
		output.engraving_tolerance = engravingToleranceParam.defaultValue;
	}
	return output;
}

// keep only string params that differ from their declared default, mirroring
// simplifyDieParams, so change-detection ignores no-op/default values.
function simplifyStringParams(
	obj: Record<string, string>,
	params: Array<StringParameter> | undefined
): Record<string, string> {
	const output: Record<string, string> = {};
	if (!params) {
		return output;
	}
	params.forEach((param) => {
		const value = obj[param.id];
		if (value != null && value !== param.defaultValue) {
			output[param.id] = value;
		}
	});
	return output;
}

function stringParamsEqual(prev: Record<string, string>, next: Record<string, string>): boolean {
	const pk = Object.keys(prev);
	const nk = Object.keys(next);
	if (pk.length !== nk.length) {
		return false;
	}
	for (const k of pk) {
		if (prev[k] !== next[k]) {
			return false;
		}
	}
	return true;
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
