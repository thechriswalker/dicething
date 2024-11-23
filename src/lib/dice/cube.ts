import { BoxGeometry } from "three";
import {
  BaseDie,
  Face,
  type DiePropertyDescriptor,
  type IDice,
} from "../model/die";
import { DiceSymbolName, type DiceSymbolSet } from "../symbols/symbols";
import { type IBlank } from "../model/iface";
import type { DiceMapEntry } from "./entry";
import { minMax } from "../util/validation";
// lets make the d6 18mm by default.
export const DefaultD6CubeSize = 18;

// map of default templates to idx of face
const facesToSymbols = {
  0: DiceSymbolName.ONE,
  1: DiceSymbolName.SIX,
  2: DiceSymbolName.FIVE,
  3: DiceSymbolName.TWO,
  4: DiceSymbolName.THREE,
  5: DiceSymbolName.FOUR,
} as Record<number, DiceSymbolName>;

function cubeBlank(props: Record<string, number>): IBlank {
  const size = props.size ?? DefaultD6CubeSize;
  return {
    name: "Cube",
    geometry: new BoxGeometry(size, size, size),
    faceIndices(faceIndex) {
      return [2 * faceIndex, 2 * faceIndex + 1];
    },
  };
}

class Cube extends BaseDie implements IDice {
  constructor(symbolSet: DiceSymbolSet, initialProps?: Record<string, number>) {
    const faces = Array.from({ length: 6 }).map((_, idx) => {
      const defaultSize = 1; // default template render size (WRT to default CubeSize)
      const defaultRotation = 0; // the amount this number should be rotated on the dice by default
      return new Face(
        idx,
        symbolSet,
        defaultSize,
        defaultRotation,
        facesToSymbols[idx]
      );
    });

    super("D6", cubeBlank, faces, initialProps);
  }

  listAvailableProperties(): Array<DiePropertyDescriptor> {
    return [
      {
        key: "size",
        name: "Size",
        description: "Cube Face Width/Height",
        bounds: [1, 100],
      },
    ];
  }
  protected refineProps(props: Record<string, number>): Record<string, number> {
    const size = minMax(props.size, 1, 100, DefaultD6CubeSize);
    return { size };
  }
}

// we export a "DiceMapEntry" compatible object
export const D6: DiceMapEntry = {
  displayName: "D6",
  displayRotation: [Math.PI / 8, Math.PI / 5],
  displayScale: 0.75,
  factory(symbolSet: DiceSymbolSet, props: Record<string, number>): IDice {
    return new Cube(symbolSet, props);
  },
};
