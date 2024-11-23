import { IcosahedronGeometry } from "three";
import {
  BaseDie,
  Face,
  type DiePropertyDescriptor,
  type IDice,
} from "../model/die";
import type { IBlank } from "../model/iface";
import { DiceSymbolName, type DiceSymbolSet } from "../symbols/symbols";
import type { DiceMapEntry } from "./entry";
import { minMax } from "../util/validation";

const DefaultWidth = 26;

const faceMap: Record<number, DiceSymbolName> = {
  0: DiceSymbolName.ONE,
  1: DiceSymbolName.TWO,
  2: DiceSymbolName.THREE,
  3: DiceSymbolName.FOUR,
  4: DiceSymbolName.FIVE,
  5: DiceSymbolName.SIX_MARKED,
  6: DiceSymbolName.SEVEN,
  7: DiceSymbolName.EIGHT,
  8: DiceSymbolName.NINE_MARKED,
  9: DiceSymbolName.TEN,
  10: DiceSymbolName.ELEVEN,
  11: DiceSymbolName.TWELVE,
  12: DiceSymbolName.THIRTEEN,
  13: DiceSymbolName.FOURTEEN,
  14: DiceSymbolName.FIFTEEN,
  15: DiceSymbolName.SIXTEEN,
  16: DiceSymbolName.SEVENTEEN,
  17: DiceSymbolName.EIGHTEEN,
  18: DiceSymbolName.NINETEEN,
  19: DiceSymbolName.TWENTY,
};

class IcosahedronDie extends BaseDie implements IDice {
  constructor(symbolSet: DiceSymbolSet, initialProps: Record<string, number>) {
    const faces = Array.from({ length: 20 }).map((_, idx) => {
      const defaultSize = 0.6;
      const defaultRotation = 0; // these will need to be set individually
      return new Face(
        idx,
        symbolSet,
        defaultSize,
        defaultRotation,
        faceMap[idx]
      );
    });

    const blank = (props: Record<string, number>): IBlank => {
      const geometry = new IcosahedronGeometry(props.size);
      return {
        name: "Icosahedron",
        geometry,
        faceIndices(faceIndex) {
          return [faceIndex]; //woohoo a simple one!
        },
      };
    };

    super("D20", blank, faces, initialProps);
  }

  listAvailableProperties(): Array<DiePropertyDescriptor> {
    return [
      {
        key: "size",
        name: "Size",
        description: "Diameter of the icosahedron",
        bounds: [1, 100],
      },
    ];
  }

  protected refineProps(props: Record<string, number>): Record<string, number> {
    const size = minMax(props.size, 1, 100, DefaultWidth);
    return { size };
  }
}

export const D20: DiceMapEntry = {
  displayName: "D20",
  displayScale: 0.4,
  displayRotation: [-Math.PI / 12, 0],
  factory(symbolSet, props) {
    return new IcosahedronDie(symbolSet, props);
  },
};
