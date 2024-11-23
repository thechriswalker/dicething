import {
  BufferGeometry,
  EdgesGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  ShapeGeometry,
  Triangle,
  Vector3,
} from "three";
import {
  debugSymbolName,
  type DiceSymbol,
  DiceSymbolName,
  type DiceSymbolSet,
  isBlank,
} from "../symbols/symbols";
import { CSG } from "three-csg-ts";
import type { IBlank, IFace, LegendTransform } from "./iface";

// a useful triangle
let _triangle = new Triangle();
let _m = new MeshBasicMaterial();

// represents one solid face of a die.
// because of the CSG slowness, we cannot apply CSG to the whole die
// as more faces are engraved the whole thing slows down.
// so here we create a geometry for a single fave that is a "pyramid" of the face back to the origin.
// then we engrave the symbol into that face.
export class Face implements IFace {
  // the index of this face, so we can update the "indices" when the blank changes.
  faceIndex: number;

  // get the last blank we saw by UUID, this is the best way to tell if it has changed.
  lastBlank: string = "";

  // this is the current "face" shape
  // based on the last seen blank.
  // I need a custom "shape" object, that only has straight lines,
  // but also has .center() and .translate(x,y) and .rotate(r) methods.
  faceGeo: BufferGeometry = new BufferGeometry();

  // the calculated center point and normal of the face.
  center = new Vector3();
  normal = new Vector3();

  // the baseSize of the template before scaling
  baseSize: number;

  // the baseRotation of the template before user-defined roation
  baseRotation: number;

  // our current symbol set
  symbols: DiceSymbolSet;

  // the default template to use for this face:
  defaultSymbolName: DiceSymbolName | undefined;

  // now the user-tweakable properties
  userScaleX: number = 1; // user scaling setting in the horizontal axis of the template
  userScaleY: number = 1; // user scaling setting in the vertical axis of the template
  userRotation: number = 0; // user rotation setting
  userOffsetX: number = 0; // these offsets a percentage should survive dice re-sizing/shaping
  userOffsetY: number = 0;
  userEngravingOffset: number = 0; // extra engraving depth.

  // in case the user switched up the templates
  currentSymbolName: DiceSymbolName;
  currentSymbol: DiceSymbol;

  // when the size/rotation is changed, we update this with
  // a boolean to see whether any of the template is outside the face.
  // this will affeect edge rendering on the template
  isTemplateContainedByFace: boolean = true;

  currentFaceRender: BufferGeometry | undefined;
  currentEdgeRender: EdgesGeometry | undefined;
  currentSymbolRender: EdgesGeometry | undefined;
  currentEngravingDepth: number = -1;
  currentFaceBaseSize: number = 1;

  constructor(
    index: number,
    symbolSet: DiceSymbolSet, // the set of symbols to use in this die
    baseSize: number, // how to scale the symbols. based on the "props.size" of the dice - which all die should implement
    baseRotation: number, // how much rotate this template (around the normal), by default
    defaultSymbolName: DiceSymbolName | undefined // the default template to use on this face
  ) {
    this.faceIndex = index;
    this.baseSize = baseSize;
    this.baseRotation = baseRotation;
    this.defaultSymbolName = defaultSymbolName;
    this.currentSymbolName = defaultSymbolName ?? DiceSymbolName.BLANK;
    this.currentSymbol = symbolSet.getSymbol(this.currentSymbolName);
    this.symbols = symbolSet;
    // we shouldn't sync the symbol until the blank is ready.
    //this.syncSymbol();
  }

  public setBlank(iblank: IBlank) {
    // better to create new blanks on scale than to try and work out if it
    // has changed.
    const blank = iblank.geometry;
    if (this.lastBlank == blank.uuid) {
      return;
    }
    const indices = iblank.faceIndices(this.faceIndex);

    // maybe new blank, in which case update center and normals and edges
    // vertex indexes should not change
    // create template and position it
    // check for boundary violation

    // first we extract the edges of the face this will be all unique vertices.
    const indexAttr = blank.getIndex();
    const posAttr = blank.getAttribute("position");

    // we need to get vertices for all triangles and create a geometry, then an edge-geometry
    // but also we need to find the centroid. we shouldn't have any vertices in the interior
    // of our face, so we can simply add the unique ones, but we need a set to keep them
    // unique. and our unique piece will need to be consistent, so a string.
    const unique = new VertexSet();
    const vertices: number[] = [];
    indices.forEach((idx) => {
      idx *= 3;
      if (indexAttr) {
        // console.log("looking up triangles for face index", idx);
        const aidx = indexAttr.getX(idx);
        const bidx = indexAttr.getY(idx);
        const cidx = indexAttr.getZ(idx);
        // console.log("index positions", aidx, bidx, cidx);
        // console.log(
        //   "index values: A:",
        //   posAttr.getX(aidx),
        //   posAttr.getY(aidx),
        //   posAttr.getZ(aidx)
        // );
        // console.log(
        //   "index values: B:",
        //   posAttr.getX(bidx),
        //   posAttr.getY(bidx),
        //   posAttr.getZ(bidx)
        // );
        // console.log(
        //   "index values: C:",
        //   posAttr.getX(cidx),
        //   posAttr.getY(cidx),
        //   posAttr.getZ(cidx)
        // );
        _triangle.a.fromBufferAttribute(posAttr, aidx);
        _triangle.b.fromBufferAttribute(posAttr, bidx);
        _triangle.c.fromBufferAttribute(posAttr, cidx);
      } else {
        _triangle.a.fromBufferAttribute(posAttr, idx);
        _triangle.b.fromBufferAttribute(posAttr, idx + 1);
        _triangle.c.fromBufferAttribute(posAttr, idx + 2);
      }
      const a = _triangle.a.clone();
      const b = _triangle.b.clone();
      const c = _triangle.c.clone();
      unique.add(a);
      unique.add(b);
      unique.add(c);
      // prettier-ignore
      vertices.push(
        a.x, a.y, a.z, 
        b.x, b.y, b.z,
        c.x, c.y, c.z,
      );
    });
    // get the center
    this.center.set(0, 0, 0);
    unique.forEach((v) => {
      this.center.add(v);
    });
    this.center.divideScalar(unique.size);

    // get normal
    _triangle.getNormal(this.normal);

    if (this.faceGeo) {
      this.faceGeo.dispose();
    }
    this.faceGeo = new BufferGeometry();
    this.faceGeo.setAttribute(
      "position",
      new Float32BufferAttribute(vertices, 3)
    );
    this.faceGeo.computeVertexNormals();

    // work out the "base size" of this face on the blank by
    // computing the bounding sphere radius, this is the best way as it doesn't
    // care about orientation, however we should be aiming to fit the
    // legend into half that size... maybe it will work?
    // otherwise I need to compute the largest circle that is INSIDE the face
    // and make the largest legend that fits INSIDE the circle.
    // of course we can fit the symbol "as large as possible"
    // by scaling the symbol until it fits in the face.
    // hopefully the CSG can be used to compute these values.
    // i.e. start with a legend.
    //  while (union doesn't change face) { make legend bigger }
    //  while (union doesn't change face) { make legend smaller }
    //  -> now it should fit.
    // maybe make that an "auto-fit symbols"
    // which does this to all "numbered" faces and creates a fixed
    // scaling that works for all faces.
    // ALL faces with numbers are similar so we just need to take the
    //
    // BUT let's bump this down the road, as we have manual correction for now.
    // this only fails for really "tall" dice, with wide numbers, like a D12 crystal
    this.faceGeo.computeBoundingSphere();
    this.currentFaceBaseSize = this.faceGeo.boundingSphere!.radius;

    this.currentEngravingDepth = -1;
    this.currentEdgeRender?.dispose();

    // we can create the edge geometry here as it is the same for all blanks.
    this.currentEdgeRender = new EdgesGeometry(this.faceGeo);
    // move the edges a little away from the normal, so they are visible.
    const delta = this.normal.clone().multiplyScalar(0.01);
    this.currentEdgeRender.translate(delta.x, delta.y, delta.z);
    this.syncSymbol();
  }

  public dispose(): void {
    this.faceGeo?.dispose();
    this.currentEdgeRender?.dispose();
    this.currentSymbolRender?.dispose();
  }

  public getFace(depth: number): BufferGeometry {
    if (isBlank(this.currentSymbol)) {
      return this.faceGeo;
    }

    if (this.currentEngravingDepth !== depth) {
      // create the mesh at the given depth
      this.currentEngravingDepth = depth;
      this.updateCurrentGeometries();
    }
    return this.currentFaceRender!;
  }

  public getFaceOutline(): EdgesGeometry {
    return this.currentEdgeRender!;
  }

  public getSymbolOutline(): EdgesGeometry | undefined {
    return this.currentSymbolRender;
  }

  public setSymbols(s: DiceSymbolSet) {
    this.symbols = s;
    this.currentSymbol = s.getSymbol(this.currentSymbolName);
    this.syncSymbol();
  }

  public setSymbol(name: DiceSymbolName) {
    this.currentSymbolName = name;
    this.currentSymbol = this.symbols.getSymbol(name);
    this.syncSymbol();
  }

  public updateLegend(transform: LegendTransform) {
    if (transform.offsetX !== undefined) {
      this.userOffsetX = transform.offsetX;
    }
    if (transform.offsetY !== undefined) {
      this.userOffsetY = transform.offsetY;
    }
    if (transform.scaleX !== undefined) {
      this.userScaleX = transform.scaleX;
    }
    if (transform.scaleY !== undefined) {
      this.userScaleY = transform.scaleY;
    }
    if (transform.rotation !== undefined) {
      this.userRotation = transform.rotation;
    }
    if (transform.engravingOffset !== undefined) {
      this.userEngravingOffset = transform.engravingOffset;
    }
    this.syncSymbol();
  }

  private syncSymbol() {
    if (isBlank(this.currentSymbol) || this.lastBlank === "") {
      this.currentEngravingDepth = -1;
      this.currentSymbolRender?.dispose();
      this.currentSymbolRender = undefined;
    } else {
      // set this to ensure we update the engraving render
      this.currentEngravingDepth = -1;
      // now the symbolRender just the front face of the symbol, and just the edges.
      this.currentSymbolRender?.dispose();
      this.currentSymbolRender = new EdgesGeometry(
        new ShapeGeometry(this.currentSymbol.shapes)
      );
      this.orientateSymbol(this.currentSymbolRender, 0.01);
    }
  }

  // translation rotation and scaling
  private orientateSymbol(s: BufferGeometry, offsetZ: number = 0) {
    s.center();
    s.translate(0, 0, offsetZ);

    // default scale and rotation
    // first we size the symbol based on it's current size and the
    // short side size of the current face.
    // this gives us a baseline, then
    // we scale by the "die" configured scale for this dice
    // finally we add any user scaling after that
    s.computeBoundingBox();
    const bb = new Vector3();
    s.boundingBox!.getSize(bb);
    console.log(
      "face",
      this.faceIndex,
      "faceShortSide",
      this.currentFaceBaseSize,
      "symbol",
      debugSymbolName(this.currentSymbolName),
      "symbolSize",
      bb
    );
    const longest = Math.max(bb.x, bb.y);
    const baselineScaling = this.currentFaceBaseSize / longest;
    console.log("baseLineScale", baselineScaling);
    console.log("per-face scale", this.baseSize);
    console.log("user scaling", this.userScaleX, this.userScaleY);
    s.scale(baselineScaling, baselineScaling, 1);
    s.scale(this.baseSize, this.baseSize, 1);
    // then apply the user scaling
    s.scale(this.userScaleX, this.userScaleY, 1);

    // // around Z
    s.rotateZ(this.baseRotation);
    s.rotateZ(this.userRotation);

    // // user translation in x and y
    s.translate(this.userOffsetX, this.userOffsetY, 0);
    // // now we need to orientate the symbol to the face.
    s.lookAt(this.normal);
    // and move to the center of the face (offset)
    s.translate(this.center.x, this.center.y, this.center.z);
  }

  private updateCurrentGeometries() {
    // we perform the CSG on just this face. much quicker that trying to do it on the whole
    // dice.
    // to do this, we create a mesh from the faceGeo, and from the shape.
    // we have a cache of the symbol, updated after property change.

    if (isBlank(this.currentSymbol)) {
      throw new Error(
        "unreachable - should not call updateCurrentGeometries on a blank face"
      );
    }

    // draw the symbol.
    //console.log("drawing symbol", { depth: this.currentEngravingDepth });
    const depth = this.currentEngravingDepth + this.userEngravingOffset;
    const s = new ExtrudeGeometry(this.currentSymbol.shapes, {
      depth: depth * 2, // double ensures there is enough depth and allows us to bevel later if we want...
      bevelEnabled: false,
    });

    this.orientateSymbol(s, -0.5 * depth);

    // finally use a CSG subtract to remove the embedded symbol bits.
    this.currentFaceRender?.dispose();
    this.currentFaceRender = CSG.subtract(
      new Mesh(this.faceGeo, _m),
      new Mesh(s, _m)
    ).geometry;
  }
}

// handy little class to keep track of unique vertices
class VertexSet {
  vertices = new Map<string, Vector3>();
  add(v: Vector3) {
    this.vertices.set(toUniqueKey(v.x, v.y, v.z), v);
  }
  get size() {
    return this.vertices.size;
  }
  [Symbol.iterator]() {
    return this.vertices.values();
  }
  forEach(fn: (v: Vector3) => void) {
    for (let v of this) {
      fn(v);
    }
  }
}

function toPrecision6(n: number): string {
  return Math.round(n * 1000000).toString();
}

function toUniqueKey(x: number, y: number, z: number): string {
  return `${toPrecision6(x)}|${toPrecision6(y)}|${toPrecision6(z)}`;
}
