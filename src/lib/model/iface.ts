import { BufferGeometry, EdgesGeometry } from "three";
import { DiceSymbolName, type DiceSymbolSet } from "../symbols/symbols";

export interface IBlank {
  readonly name: string;
  readonly geometry: BufferGeometry;
  faceIndices(faceIndex: number): Array<number>;
}

export type LegendTransform = {
  offsetX?: number;
  offsetY?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  engravingOffset?: number; // extra depth of engraving, on just this face
};

export interface IFace {
  // update the symbol set
  setSymbols(s: DiceSymbolSet): void;
  // give it a new (sized) blank, possibly with new face indexes
  setBlank(blank: IBlank): void;
  // update the legend transform
  updateLegend(transform: LegendTransform): void;
  // update the symbol on the face
  setSymbol(symbol: DiceSymbolName): void;

  // get the engraved face geometry
  getFace(engravingDepth: number): BufferGeometry;
  // get the outline of the face
  getFaceOutline(): EdgesGeometry;
  // get the outline of the symbol (undefined for a blank)
  getSymbolOutline(): EdgesGeometry | undefined;

  // dispose of anything threejs related that needs cleaning up
  dispose(): void;
}
