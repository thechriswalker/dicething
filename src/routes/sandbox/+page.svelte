<script lang="ts">
	import AppBar from '$lib/components/app_bar/AppBar.svelte';

	import dice from '$lib/dice/index';
	import type { FaceParams } from '$lib/interfaces/dice';
	import { findAllBadTriangles } from '$lib/utils/bad_edges';
	import { Builder } from '$lib/utils/builder';
	import fonts, { blanks, type Builtin } from '$lib/fonts';
	import { createBaseSceneAndRenderer, createGridHelper } from '$lib/utils/scene';
	import { AxesHelper, MeshBasicMaterial, MeshNormalMaterial, Vector2 } from 'three';
	import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
	import { hoverEvents } from '$lib/utils/events';
	import { Legend, type LegendSet } from '$lib/utils/legends';

	// function hexagon(radius: 4): Shape {
	// 	const r = radius;
	// 	const a = radius / 2;
	// 	const sq3 = (Math.sqrt(3) * a) / 2;
	// 	return new Shape([
	// 		new Vector2(-r, 0),
	// 		new Vector2(-a, sq3),
	// 		new Vector2(a, sq3),
	// 		new Vector2(r, 0),
	// 		//new Vector2(r, -1),
	// 		new Vector2(a, -sq3),
	// 		new Vector2(-a, -sq3)
	// 	]);
	// }
	// const origin = new Vector2();
	// function semiCircle(radius: 4): Shape {
	// 	const s = new Shape();
	// 	const start = new Vector2(-radius, 0);
	// 	start.rotateAround(origin, Math.PI / 6);
	// 	s.lineTo(start.x, start.y);
	// 	s.absellipse(0, 0, radius, radius * 2, -Math.PI, 0, true, Math.PI / 6);
	// 	s.ellipse(start.x / 2, start.y / 2, radius / 2, radius, 0, Math.PI, true, Math.PI / 6);
	// 	return s;
	// }

	// let's do everything right here for now as a complete demo process.

	// our "Dice" is going to be an Array of "shapes", and each symbol is an array of "shapes".

	// the positioning of the symbol on the face will be done at the origin, then "cut into" the main shape as a hole.
	// e.g. using ShapeUtils.triangulateShape(contour, holes), or the logic within.
	// we can then "engrave" by creating a "shapes geometry" from both the face and the symbol,
	// then we can move the symbol the engraving distance and create the walls.
	// just need to work out how to calculate the normals, or how to orient the triangle so "outside" is the right way out.

	// creating the walls is just finding each pair of vertices on the shape and creating two triangles to form a rectangular wall.
	// if we travel clockwise around the shape, then we should be able to always get the orientation of the triangles correct by simply using the right order for each of the two per wall.

	// once we have a bunch of "shape" geometries we must combine them to obtain the full engraved dice.

	// first a quick test, carve a shape into a cube, but using more triangles. in case that helps with the CSG
	// -> that didn't help, the STL still ended up non-manifold.

	// so I need to do the CSG myself.
	// but it's really hard, however we can limit the difficulty by writing an algorithm that knows in advance
	// a few things.
	// firstly we are not operating on arbitrary polygons, just triangles. Everything needs to be split into triangles.
	// secondly we are only operating in a 2d space.
	// finally, we only care about subtraction and specifically bounded subtraction, i.e. cutting a hole.
	// this means that every point on the subtracted shape will end up as a new vertex INSIDE the resultant shape.
	// This means we can assert this at the start an make some assumptions about our A - B function that B must be contained in A
	// and we know that A has no holes. It really feels like we should simply be able to use SVG and even-odd-ordering to
	// create the shape we want without having to do CSG at all...
	// or in fact:

	// - start with the "shape" of the face.
	// - create an array of shapes with the face as the only entry.
	// - take the "shapes" we want to cut as holes. for each
	//   - take the shape's holes and "reverse" each of them. they are now solids.
	//   - take the shape's points and "reverse" them, they are now holes.
	//   - add the reversed points to the face shape to cut the holes.
	//   - add the reversed holes to the array of shapes.
	// - create a "ShapeGeometry" from the group.
	// - create a "ShapeGeometry" from the original shapes for the holes.
	// - translate the hole shape backwards the engraving distance.
	// - Now create a new BufferGeometry from the face shape geometry, the engraved shape geometry
	//   AND for every pair of points in each of the holes shapes (and their holes):
	//   - add 2 triangles to connect the two points with the matching to vertices on the face, to create the walls.
	// - now position the BufferGeometry in the correct place in 3D space to be the face of the dice. up to now we have been
	//   working at the origin and facing a known single direction
	// - now add all the BufferGeometries for each face to a Group.
	// - create the STL from the group.

	// a D6 has 6 square faces.
	// lets just engrave on one for now.
	// and lets make our shape super simple.
	// let shapes = six; //[semiCircle(4)]; //six;
	// shapes = centerShapes(...shapes);
	// //shapes = shapes.map((s) => scaleShape(s, 0.8));

	// shapes = rotateShapes(Math.PI / 4, ...shapes);

	// const engravingShapes = shapes; //centerShapes(...six); //[hexagon(4)];

	// const cubeHalfSide = 10;

	// const squareFace = new Shape([
	// 	new Vector2(cubeHalfSide, cubeHalfSide),
	// 	new Vector2(cubeHalfSide, -cubeHalfSide),
	// 	new Vector2(-cubeHalfSide, -cubeHalfSide),
	// 	new Vector2(-cubeHalfSide, cubeHalfSide)
	// ]);

	// const faceGeo = engrave(
	// 	squareFace,
	// 	engravingShapes,
	// 	{
	// 		scale: 0.7,
	// 		rotate: Math.PI / 6,

	// 		translate: [-3, -1]
	// 	},
	// 	1,
	// 	DefaultDivisions
	// );

	// // move to the correct place.
	// // add the other cube faces.
	// const baseFace = new ShapeGeometry([squareFace], DefaultDivisions)
	// 	.translate(0, 0, cubeHalfSide)
	// 	.toNonIndexed();
	// delete baseFace.attributes.uv;

	// const _m = new MeshNormalMaterial();
	// //const _m = new MeshPhongMaterial({ color: 0x3333ff });
	// // const _m = new MeshStandardMaterial({
	// // 	roughness: 0.7,
	// // 	color: 0x6666ff
	// // });
	// //const _m = new MeshLambertMaterial({ color: 0xeeeeee });

	// const faceGroup = new Group();
	// faceGeo.forEach((f) => {
	// 	const m = new Mesh(f, _m);
	// 	faceGroup.add(m);
	// });
	// const edges = new EdgesGeometry(faceGeo[2], Math.PI/12);CurvePath
	// const lineMat = new LineBasicMaterial({ color: 0x000000, linewidth: 2 });
	// const edgeM = new LineSegments(edges, lineMat)
	// faceGroup.add(edgeM)
	// faceGroup.translateZ(cubeHalfSide);
	// const others = new Group();
	// [
	// 	baseFace.clone().rotateX(Math.PI / 2),
	// 	baseFace.clone().rotateX(-Math.PI / 2),
	// 	baseFace.clone().rotateY(Math.PI / 2),
	// 	baseFace.clone().rotateY(-Math.PI / 2),
	// 	baseFace.clone().rotateY(Math.PI)
	// 	// and our face.
	// ].forEach((geo) => {
	// 	others.add(new Mesh(geo, _m));
	// });

	// const combined = new Group();
	// combined.add(faceGroup, others);
	// //const merged = BufferGeometryUtils.mergeVertices(combined, 0.05);
	// const merged = combined;
	// merged.computeVertexNormals();

	//combined.add(edgeM)

	//const wireframe = new WireframeGeometry(merged);

	// const line = new LineSegments(wireframe);
	// line.material.depthTest = false;
	// line.material.opacity = 0.25;
	// line.material.transparent = true;

	//const m = new Mesh(merged, new MeshNormalMaterial());

	// const centeredSix = centerShapes(...six);

	// const simpleLegends: LegendSet = {
	// 	get(l: Legend) {
	// 		if (l === Legend.ONE) {
	// 			return centeredSix;
	// 		}
	// 		return []; // blank
	// 	}
	// };

	//const builder1 = new Builder(CrystalD12, legends);
	const builder2 = new Builder(dice.shard_d4, blanks);
	const builder = builder2;

	function time<R>(msg: string, fn: () => R): R {
		const before = Date.now();
		const out = fn();
		console.log(msg, Date.now() - before);
		return out;
	}
	const dieParams: Record<string, number> = {
		//	size: 28
		// twist: 0.3
	};
	const faceParams: Array<FaceParams> = [
		{ legend: Legend.DOUBLE_ZERO }
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK },
		// { legend: Legend.BLANK }
		// { rotation: -Math.PI / 2, offset: new Vector2(0, 5) },
		// { rotation: -Math.PI / 2, offset: new Vector2(0, 5) },
		// { rotation: Math.PI / 2, offset: new Vector2(0, -5) }
	];

	const changeFont = (f: Builtin) => {
		f.load().then((ff) => {
			builder.changeLegends(ff);
			builder.build(dieParams, faceParams);
		});
	};
	changeFont(fonts.germania_one);

	// lets introspect the symbol shape.
	// const l = legends.get(Legend.TWO);
	// l[0].curves.forEach((c) => {
	// 	// lets find start and finish points.
	// 	let start: Vector2;
	// 	let finish: Vector2;
	// 	switch (c.type) {
	// 		case 'LineCurve':
	// 			start = (c as LineCurve).v1;
	// 			finish = (c as LineCurve).v2;
	// 			break;
	// 		case 'QuadraticBezierCurve':
	// 			start = (c as QuadraticBezierCurve).v0;
	// 			finish = (c as QuadraticBezierCurve).v2;
	// 			break;
	// 		default:
	// 			throw new Error('unknown curve: ' + c.type);
	// 	}
	// 	console.log('CURVE:  START', start.x, start.y, c.type);
	// 	console.log('CURVE: FINISH', finish.x, finish.y, c.type);
	// });
	// console.log({ zero: l });

	function downloadSTL() {
		const exporter = new STLExporter();
		const out = time('detail render', () => builder.export(dieParams, faceParams));
		time('find bad after render', () => findAllBadTriangles(out));
		const data = exporter.parse(out, { binary: true });
		const link = document.createElement('a');
		link.download = 'test.stl';
		link.href = URL.createObjectURL(new Blob([data], { type: 'model/stl' }));
		link.style.display = 'none';
		document.body.appendChild(link);
		link.click();
	}

	const gridHelper = createGridHelper(60);
	let showGridHelper = false;
	let scene: ReturnType<typeof createBaseSceneAndRenderer>;

	function toggleGrid() {
		showGridHelper = !showGridHelper;
		if (scene) {
			if (showGridHelper) {
				scene.scene.add(gridHelper);
			} else {
				scene.scene.remove(gridHelper);
			}
		}
	}
	let showMain = false;
	function toggleMain() {
		showMain = !showMain;
		if (scene) {
			if (showMain) {
				scene.scene.add(merged);
			} else {
				scene.scene.remove(merged);
			}
		}
	}

	let showBad = false;
	function toggleBad() {
		showBad = !showBad;
		if (scene && bad) {
			if (showBad) {
				scene.scene.add(bad);
			} else {
				scene.scene.remove(bad);
			}
		}
	}

	let showWireframe = false;
	const m1 = new MeshNormalMaterial({ wireframe: showWireframe });
	const m2 = new MeshBasicMaterial({ color: 0x444444, wireframe: showWireframe });
	function toggleWireframe() {
		showWireframe = !showWireframe;
		m1.wireframe = showWireframe;
		m1.needsUpdate = true;
		m2.wireframe = showWireframe;
		m2.needsUpdate = true;
	}
	builder.setFrontMaterial(m1);
	builder.setWallMaterial(m1);
	builder.setEngravedMaterial(m2);

	time('building mesh took', () => builder.build(dieParams, faceParams));
	const merged = builder.diceGroup;
	const bad = time('calculating bad triangles', () => findAllBadTriangles(merged));

	let hoverFace = -1;

	// first let's set up the canvas on mount
	let target: HTMLDivElement;
	$effect(() => {
		if (target) {
			scene = createBaseSceneAndRenderer(target);
			const axesHelper = new AxesHelper(50);
			scene.scene.add(axesHelper);

			// a square on the xy plane
			// const blue = new MeshBasicMaterial({ color: 0x0000ff, side: DoubleSide });
			// const red = new MeshBasicMaterial({ color: 0xff0000, side: DoubleSide });
			// const green = new MeshBasicMaterial({ color: 0x00ff00, side: DoubleSide });
			// const square = [
			// 	new Vector3(0, 12, 0),
			// 	new Vector3(4.710277376051325e-16, 9.17157287525381, 4.000000000000001),
			// 	new Vector3(-4, 6.343145750507624, 4.000000000000001),
			// 	new Vector3(-4.000000000000001, 9.17157287525381, 1.7763568394002505e-15)
			// ];
			// const original = new BufferGeometry();
			// const [a, b, c, d] = square;

			// const positions = [
			// 	// 2 triangles.
			// 	a.x,
			// 	a.y,
			// 	a.z,
			// 	b.x,
			// 	b.y,
			// 	b.z,
			// 	c.x,
			// 	c.y,
			// 	c.z,

			// 	// and
			// 	a.x,
			// 	a.y,
			// 	a.z,
			// 	c.x,
			// 	c.y,
			// 	c.z,
			// 	d.x,
			// 	d.y,
			// 	d.z
			// ];
			// original.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
			// original.computeVertexNormals();

			// const og = new Mesh(original, blue);
			// scene.scene.add(og);
			// const oriented = orientCoplanarVertices(square);
			// const ng = new Mesh(new ShapeGeometry(oriented.shape), red);
			// scene.scene.add(ng);

			// const face = new Shape([
			// 	new Vector2(-4, 6.343145750507624),
			// 	new Vector2(4.710277376051325e-16, 9.17157287525381),
			// 	new Vector2(4, 6.343145750507624),
			// 	new Vector2(4, -6.343145750507624),
			// 	new Vector2(-1.5942214740877591e-15, -9.17157287525381),
			// 	new Vector2(-4, -6.343145750507624)
			// ]);
			// const s = new Mesh(new ShapeGeometry(face), green);
			// scene.scene.add(s);

			toggleGrid();
			toggleMain();
			//toggleBad();
			scene.render();

			hoverEvents(target, scene.camera, merged, (ev) => {
				console.log(ev);
				if (ev.face !== hoverFace) {
					if (hoverFace !== -1) {
						builder.setFaceOutline(hoverFace, false);
					}
					hoverFace = ev.face;
					if (hoverFace !== -1) {
						builder.setFaceOutline(hoverFace, true);
					}
				}
			});

			return () => {
				scene.dispose();
			};
		}
	});
</script>

<AppBar />
<div class="w-full grow overflow-hidden" bind:this={target}></div>
<div class="flex flex-row gap-8 p-8">
	<p><button class="btn preset-filled-primary-500" onclick={downloadSTL}>download stl</button></p>
	<p><button class="btn preset-filled-primary-500" onclick={toggleGrid}>toggle grid</button></p>
	<p><button class="btn preset-filled-primary-500" onclick={toggleMain}>toggle main</button></p>
	<p><button class="btn preset-filled-primary-500" onclick={toggleBad}>toggle bad</button></p>
	<p>
		<button class="btn preset-filled-primary-500" onclick={toggleWireframe}>toggle wireframe</button
		>
	</p>
	<p>
		<select onchange={(ev) => changeFont(fonts[ev.currentTarget.value as keyof typeof fonts])}>
			{#each Object.entries(fonts) as [k, v]}
				<option value={k}>{v.name}</option>
			{/each}
		</select>
	</p>
</div>
