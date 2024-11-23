import {
  BaseDie,
  Face,
  type DiePropertyDescriptor,
  type IDice,
} from "../model/die";
import { barrel } from "../shapes/barrel";
import { DiceSymbolName, type DiceSymbolSet } from "../symbols/symbols";
import { minMax } from "../util/validation";
import type { DiceMapEntry } from "./entry";

const DefaultWidth = 14;
const DefaultMainHeight = 16;
const DefaultCapHeight = 6;

const barrelBlank =
  (n: number) =>
  (props: Record<string, number> = {}) => {
    console.log("barrel blank", n, props);
    const diameter = props.width ?? DefaultWidth;
    const capHeight = props.cap_height ?? DefaultCapHeight;
    const mainHeight = props.main_height ?? DefaultMainHeight;
    let twist = props.twist ?? 1;
    if (twist >= 1) {
      twist = 0;
    }
    if (twist < 0) {
      twist = 0;
    }

    const opts = {
      N: n,
      Radius: diameter / 2,
      CapHeight: capHeight <= 0 ? Number.EPSILON : capHeight,
      MainHeight: mainHeight <= 0 ? Number.EPSILON : mainHeight,
      Twist: (twist * Math.PI) / (n / 2),
    };
    return barrel(opts);
  };

const defaultLegendSize: Record<number, number> = {
  4: 1,
  6: 0.8,
  8: 0.7,
  10: 0.5,
  12: 0.4,
};

class BarrelDie extends BaseDie implements IDice {
  constructor(
    name: string,
    n: number,
    faceMap: Record<number, DiceSymbolName>,
    symbolSet: DiceSymbolSet,
    initialProps: Record<string, number> = {}
  ) {
    // 3x n faces, but 2/3 are blank
    const faces = Array.from({ length: 3 * n }).map((_, idx) => {
      const blank = idx > n;
      const defaultSize = defaultLegendSize[n] ?? 1;
      const defaultRotation = 0; // inverted as they are on the bottom faces.
      return new Face(
        idx,
        symbolSet,
        defaultSize,
        defaultRotation,
        blank ? DiceSymbolName.BLANK : faceMap[n - idx - 1]
      );
    });

    super(name, barrelBlank(n), faces, initialProps);
  }

  listAvailableProperties(): Array<DiePropertyDescriptor> {
    return [
      {
        key: "width",
        name: "Diameter",
        description: "Diameter of the barrel",
        bounds: [1, 100],
      },
      {
        key: "cap_height",
        name: "Cap Height",
        description: "Height of the caps",
        bounds: [0, 100],
      },
      {
        key: "main_height",
        name: "Body Height",
        description: "Length of the main barrel",
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
    const capHeight = minMax(
      props.cap_height,
      Number.EPSILON,
      100,
      DefaultCapHeight
    );
    const mainHeight = minMax(
      props.main_height,
      Number.EPSILON,
      100,
      DefaultMainHeight
    );
    const twist = minMax(props.twist, 0, 1, 0.5, true);
    return { width, cap_height: capHeight, main_height: mainHeight, twist };
  }
}

export const BarrelD4: DiceMapEntry = {
  displayName: "D4 Barrel",
  factory(symbolSet, props) {
    return new BarrelDie(
      "D4",
      4,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.TWO,
        2: DiceSymbolName.FOUR,
        3: DiceSymbolName.THREE,
      },
      symbolSet,
      props
    );
  },
};

export const BarrelD6: DiceMapEntry = {
  displayName: "D6 Barrel",
  factory(symbolSet, props) {
    return new BarrelDie(
      "D6",
      6,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.TWO,
        2: DiceSymbolName.FOUR,
        3: DiceSymbolName.THREE,
        4: DiceSymbolName.FIVE,
        5: DiceSymbolName.SIX,
      },
      symbolSet,
      props
    );
  },
};

export const BarrelD8: DiceMapEntry = {
  displayName: "D8 Barrel",
  factory(symbolSet, props) {
    return new BarrelDie(
      "D8",
      8,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.TWO,
        2: DiceSymbolName.FOUR,
        3: DiceSymbolName.THREE,
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

export const BarrelD10: DiceMapEntry = {
  displayName: "D10 Barrel",
  factory(symbolSet, props) {
    return new BarrelDie(
      "D10",
      10,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.TWO,
        2: DiceSymbolName.FOUR,
        3: DiceSymbolName.THREE,
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
export const BarrelD00: DiceMapEntry = {
  displayName: "D% Barrel",
  factory(symbolSet, props) {
    return new BarrelDie(
      "D%",
      10,
      {
        0: DiceSymbolName.TEN,
        1: DiceSymbolName.TWENTY,
        2: DiceSymbolName.FORTY,
        3: DiceSymbolName.THIRTY,
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

export const BarrelD12: DiceMapEntry = {
  displayName: "D12 Barrel",
  factory(symbolSet, props) {
    return new BarrelDie(
      "D12",
      12,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.TWO,
        2: DiceSymbolName.FOUR,
        3: DiceSymbolName.THREE,
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
