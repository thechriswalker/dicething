import { BufferGeometry } from "three";
import { type DiceSymbolSet } from "../symbols/symbols";
import { type IBlank, type IFace } from "./iface";

// and the face implementation we will use
export { Face } from "./face";

// note that we will assume that all geometrys have been converted to "non-indexed", so
// we have the vertices indexes as geometry.positions.
// has a reference to the geometry of the base shape
// the list of faces which have a geometry for the
// symbol to be engraved (or null for no symbol). and
// and offsets from the default positioning of the faces.
// (also the default positioning on the symbols on the faces)
//
// It also keeps a cache of a geometry that is created by applying the
// faces with an engraving depth to the dice.
export interface IDice {
  getLabel(): string;
  setLabel(s: string): void;
  getShapeName(): string;
  getFace(idx: number): IFace;
  getBlank(): IBlank;
  getFaces(): Array<BufferGeometry>;
  updateSymbolSet(s: DiceSymbolSet): void;
  listAvailableProperties(): Array<DiePropertyDescriptor>;
  getProperties(): Record<string, number>;
  setProperties(props: Record<string, number>): void;
  sync(): void;
  dispose(): void;
}

// this allows dynamic UI building.
export type DiePropertyDescriptor = {
  key: string;
  name: string; // human readable short name
  description: string; // human readable longer description
  bounds: [number, number]; // lower/upper bounds of property
  step?: number; // hint at step size in slider
};

export class BaseDie {
  private label: string = "";
  private diceTypeName: string;

  // how to create a blank for the props
  private blankFactory: (props: Record<string, number>) => IBlank;

  // this is the "current" render, i.e. with engravings (not edges)
  private currentFaces: Array<BufferGeometry> = [];

  // the list of faces
  private faces: Array<IFace>;

  private properties: Record<string, number>;
  private propsDirty: boolean;

  engravingDepth: number = 0.5; // mm

  constructor(
    diceTypeName: string,
    blankFactory: (props: Record<string, number>) => IBlank,
    faces: Array<IFace>,
    initialProps?: Record<string, number>
  ) {
    this.diceTypeName = diceTypeName;
    this.blankFactory = blankFactory;
    this.faces = faces;
    this.properties = this.refineProps(initialProps ?? {});
    this.propsDirty = true;
  }

  public dispose() {
    this.faces.forEach((f) => {
      f.dispose();
    });
  }

  public updateSymbolSet(s: DiceSymbolSet) {
    // update each face an sync
    this.faces.forEach((f) => {
      f.setSymbols(s);
    });
    this.propsDirty = true;
    this.sync();
  }

  public getShapeName() {
    return `${this.diceTypeName} (${this.getBlank().name})`;
  }

  public getLabel() {
    if (!this.label) {
      // the simple one.
      this.label = `My ${this.diceTypeName}`;
    }
    return this.label;
  }
  public setLabel(s: string) {
    this.label = s;
  }

  public getFace(idx: number): IFace {
    return this.faces[idx];
  }

  public getBlank() {
    this.sync();
    return this.blankFactory(this.properties);
  }
  public getFaces() {
    this.sync();
    return this.currentFaces;
  }

  public getProperties() {
    return { ...this.properties }; // a copy
  }
  // hard replace the properties!
  public setProperties(props: Record<string, number>) {
    const properties = this.refineProps({ ...props });
    // are they different?
    this.propsDirty = !propsEqual(this.properties, properties);
    this.properties = properties;
    this.sync();
  }

  // implemented by subclasses to "clamp" or fix certain props.
  protected refineProps(props: Record<string, number>): Record<string, number> {
    throw new Error("must be implemented in sub-class");
  }

  public sync() {
    // create new blank?
    // if the properties have changed, we need a new blank.
    if (this.propsDirty) {
      this.properties = this.refineProps(this.properties);
      const blank = this.blankFactory(this.properties);
      this.currentFaces = [];
      this.faces.forEach((face) => {
        // sync first as the blank has the correct faces/indices
        face.setBlank(blank);
        // the engraving to mesh that should have a "similar" geometry
        // (possibly with other faces engraved)
        this.currentFaces.push(face.getFace(this.engravingDepth));
      });
      this.propsDirty = false;
    }
  }
}

function propsEqual(
  a: Record<string, number>,
  b: Record<string, number>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  let key;
  for (let i = 0; i < aKeys.length; i++) {
    key = aKeys[i];
    if (key in b === false) {
      return false;
    }
    if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}
