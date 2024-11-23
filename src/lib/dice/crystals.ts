import {
  BaseDie,
  Face,
  type DiePropertyDescriptor,
  type IDice,
} from "../model/die";
import { crystal } from "../shapes/crystal";
import { DiceSymbolName, type DiceSymbolSet } from "../symbols/symbols";
import { minMax } from "../util/validation";
import type { DiceMapEntry } from "./entry";

const DefaultWidth = 14;
const DefaultCapHeight = 4;
const DefaultMainHeight = 20;

const crystalBlank =
  (n: number) =>
  (props: Record<string, number> = {}) => {
    const diameter = props.width ?? DefaultWidth;
    const capHeight = props.cap_height ?? DefaultCapHeight;
    const mainHeight = props.main_height ?? DefaultMainHeight;
    const opts = {
      N: n,
      Radius: diameter / 2,
      CapHeight: capHeight,
      MainHeight: mainHeight,
      Twist: props.twist ?? 0,
    };
    return crystal(opts);
  };

// like the Trapezohedron Die, but uneven and with
// number on only one side
class CrystalDie extends BaseDie implements IDice {
  constructor(
    name: string,
    n: number,
    faceMap: Record<number, DiceSymbolName>,
    symbolSet: DiceSymbolSet,
    initialProps: Record<string, number> = {}
  ) {
    // 2x n faces, but half are blank
    const faces = Array.from({ length: 2 * n }).map((_, idx) => {
      const defaultSize = 1;
      const defaultRotation = Math.PI; // inverted as they are on the bottom faces.
      return new Face(
        idx,
        symbolSet,
        defaultSize,
        defaultRotation,
        faceMap[idx - n] ?? DiceSymbolName.BLANK
      );
    });

    super(name, crystalBlank(n), faces, initialProps);
  }

  listAvailableProperties(): Array<DiePropertyDescriptor> {
    return [
      {
        key: "width",
        name: "Diameter",
        description: "Diameter at the width point",
        bounds: [1, 100],
      },
      {
        key: "cap_height",
        name: "Cap Height",
        description: "Height of the cap",
        bounds: [0, 100],
      },
      {
        key: "main_height",
        name: "Body Height",
        description: "Length of the long point",
        bounds: [1, 100],
      },
      {
        key: "twist",
        name: "Twist",
        description: "How much to twist the cap",
        bounds: [0, 1],
        step: 0.05,
      },
    ];
  }
  protected refineProps(props: Record<string, number>): Record<string, number> {
    const width = minMax(props.width, 0, 100, DefaultWidth);
    const capHeight = minMax(props.cap_height, 0, 100, DefaultCapHeight);
    const mainHeight = minMax(props.main_height, 0, 100, DefaultMainHeight);
    const twist = minMax(props.twist, 0, 1, 0.5, true);
    return { width, cap_height: capHeight, main_height: mainHeight, twist };
  }
}

export const CrystalD4: DiceMapEntry = {
  displayName: "D4 Crystal",
  displayRotation: [Math.PI / 16, Math.PI / 12],
  factory(symbolSet, props) {
    return new CrystalDie(
      "D4",
      4,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.TWO,
        2: DiceSymbolName.THREE,
        3: DiceSymbolName.FOUR,
      },
      symbolSet,
      props
    );
  },
};

export const CrystalD6: DiceMapEntry = {
  displayName: "D6 Crystal",
  displayRotation: [Math.PI / 8, Math.PI / 8],
  factory(symbolSet, props) {
    return new CrystalDie(
      "D6",
      6,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.TWO,
        2: DiceSymbolName.THREE,
        3: DiceSymbolName.FOUR,
        4: DiceSymbolName.FIVE,
        5: DiceSymbolName.SIX,
      },
      symbolSet,
      props
    );
  },
};

export const CrystalD8: DiceMapEntry = {
  displayName: "D8 Crystal",
  displayRotation: [Math.PI / 6, Math.PI / 7],
  factory(symbolSet, props) {
    return new CrystalDie(
      "D8",
      8,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.TWO,
        2: DiceSymbolName.THREE,
        3: DiceSymbolName.FOUR,
        4: DiceSymbolName.FIVE,
        5: DiceSymbolName.SIX,
        6: DiceSymbolName.SEVEN,
        7: DiceSymbolName.EIGHT,
      },
      symbolSet,
      props
    );
  },
};

export const CrystalD10: DiceMapEntry = {
  displayName: "D10 Crystal",
  displayRotation: [Math.PI / 9, Math.PI / 7],
  factory(symbolSet, props) {
    return new CrystalDie(
      "D10",
      10,
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
        9: DiceSymbolName.ZERO,
      },
      symbolSet,
      props
    );
  },
};
export const CrystalD00: DiceMapEntry = {
  displayName: "D% Crystal",
  displayRotation: [Math.PI / 9, Math.PI / 7],
  factory(symbolSet, props) {
    return new CrystalDie(
      "D00",
      10,
      {
        0: DiceSymbolName.TEN,
        1: DiceSymbolName.TWENTY,
        2: DiceSymbolName.THIRTY,
        3: DiceSymbolName.FORTY,
        4: DiceSymbolName.FIFTY,
        5: DiceSymbolName.SIXTY,
        6: DiceSymbolName.SEVENTY,
        7: DiceSymbolName.EIGHTY,
        8: DiceSymbolName.NINETY,
        9: DiceSymbolName.DOUBLE_ZERO,
      },
      symbolSet,
      props
    );
  },
};

export const CrystalD12: DiceMapEntry = {
  displayName: "D12 Crystal",
  displayRotation: [Math.PI / 9, Math.PI / 7],
  factory(symbolSet, props) {
    return new CrystalDie(
      "D12",
      12,
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
