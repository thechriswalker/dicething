import { DodecahedronGeometry } from "three";
import {
  BaseDie,
  Face,
  type DiePropertyDescriptor,
  type IDice,
} from "../model/die";
import type { IBlank } from "../model/iface";
import { rhombicDodecahedron } from "../shapes/rhombic_dodecahedron";
import { DiceSymbolName, type DiceSymbolSet } from "../symbols/symbols";
import type { DiceMapEntry } from "./entry";
import { minMax } from "../util/validation";

const DefaultWidth = 14;

function dodecahedron(r: number): IBlank {
  const geometry = new DodecahedronGeometry(r);
  return {
    name: "Dodecahedron",
    geometry,
    faceIndices(faceIndex) {
      return [3 * faceIndex, 3 * faceIndex + 1, 3 * faceIndex + 2];
    },
  };
}

class DodecahedronDie extends BaseDie implements IDice {
  constructor(
    isRhombic: boolean,
    faceMap: Record<number, DiceSymbolName>,
    symbolSet: DiceSymbolSet,
    initialProps: Record<string, number>
  ) {
    const faces = Array.from({ length: 12 }).map((_, idx) => {
      const defaultSize = 0.7;
      const defaultRotation = 0; // these number will need to change, probably part of the faceMap...
      return new Face(
        idx,
        symbolSet,
        defaultSize,
        defaultRotation,
        faceMap[idx]
      );
    });

    const blank = isRhombic
      ? (props: Record<string, number>): IBlank => {
          return rhombicDodecahedron(props.size ?? DefaultWidth);
        }
      : (props: Record<string, number>): IBlank => {
          return dodecahedron(props.size ?? DefaultWidth);
        };

    super("D12", blank, faces, initialProps);
  }

  listAvailableProperties(): Array<DiePropertyDescriptor> {
    return [
      {
        key: "size",
        name: "Size",
        description: "Diameter of the dodecahedron",
        bounds: [1, 100],
      },
    ];
  }
  protected refineProps(props: Record<string, number>): Record<string, number> {
    const size = minMax(props.size, 1, 100, DefaultWidth);
    return { size };
  }
}

export const D12: DiceMapEntry = {
  displayName: "D12",
  displayScale: 0.7,
  displayRotation: [0, Math.PI / 7],
  factory(symbolSet, props) {
    return new DodecahedronDie(
      false,
      {
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
      },
      symbolSet,
      props
    );
  },
};

export const Rhombic12: DiceMapEntry = {
  displayName: "D12 Rhombic",
  displayScale: 0.9,
  displayRotation: [0, Math.PI / 3],
  factory(symbolSet, props) {
    return new DodecahedronDie(
      true,
      {
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
      },
      symbolSet,
      props
    );
  },
};
