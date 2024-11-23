import {
  BaseDie,
  Face,
  type DiePropertyDescriptor,
  type IDice,
} from "../model/die";
import { DiceSymbolName, type DiceSymbolSet } from "../symbols/symbols";
import type { DiceMapEntry } from "./entry";
import { crystal } from "../shapes/crystal";

// lets make the d6 18mm by default.
export const DefaultHeight = 24;
export const DefaultWidth = 20;

// this is just an "even" crystal
const trapezohedronBlank = (n: number) => (props: Record<string, number>) => {
  const diameter = props.width;
  const height = props.height;

  // the twist makes the dice actually work as a die.
  // if we have an even number of faces N, then we need a zero twist,
  // with an odd number we need a PI/N twist

  const opts = {
    N: n,
    Radius: diameter / 2,
    CapHeight: height / 2,
    MainHeight: height / 2,
    Twist: n % 2 == 0 ? 0 : Math.PI / n,
  };
  return crystal(opts);
};

class TrapezohedronDie extends BaseDie implements IDice {
  constructor(
    name: string,
    n: number,
    faceMap: Record<number, DiceSymbolName>,
    symbolSet: DiceSymbolSet,
    initialProps: Record<string, number> = {}
  ) {
    // if rotation mod pi/n == 0 then we have a dipyramid
    // and there is only one triangle per face!
    // we should really double that 2 two triangle to keep this simple....
    // otherowise our indices rely on our blank. We could make the "blank" a type
    // with geometry, and a faces => indices function/map.
    // then as it changes we can update the indices as well.

    // @TODO support for dipyramids - will want that for the "default" D8

    const faces = Array.from({ length: n * 2 }).map((_, idx) => {
      const defaultSize = 0.7; // default template render size (WRT to default CubeSize)

      // they should be upside down on the last half of the faces
      const defaultRotation = idx >= n ? Math.PI : 0; // the amount this number should be rotated on the dice by default

      return new Face(
        idx,
        symbolSet,
        defaultSize,
        defaultRotation,
        faceMap[idx]
      );
    });
    super(name, trapezohedronBlank(n), faces, initialProps);
  }
  listAvailableProperties(): Array<DiePropertyDescriptor> {
    return [
      {
        key: "width",
        name: "Diameter",
        description: "Diameter around the middle",
        bounds: [1, 100],
      },
      {
        key: "height",
        name: "Height",
        description: "Height from point to point",
        bounds: [1, 100],
      },
    ];
  }
  protected refineProps(props: Record<string, number>): Record<string, number> {
    const width = props.width ?? DefaultWidth;
    const height = props.height ?? DefaultHeight;
    return { width, height };
  }
}

export const D10: DiceMapEntry = {
  displayName: "D10",
  factory(symbolSet, props) {
    return new TrapezohedronD10(symbolSet, props);
  },
};
class TrapezohedronD10 extends TrapezohedronDie {
  constructor(
    symbolSet: DiceSymbolSet,
    initialProps: Record<string, number> = {}
  ) {
    super(
      "D10",
      5,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.SEVEN,
        2: DiceSymbolName.THREE,
        3: DiceSymbolName.FIVE,
        4: DiceSymbolName.NINE_MARKED,
        //
        5: DiceSymbolName.TWO,
        6: DiceSymbolName.EIGHT,
        7: DiceSymbolName.ZERO,
        8: DiceSymbolName.FOUR,
        9: DiceSymbolName.SIX_MARKED,
      },
      symbolSet,
      initialProps
    );
  }
}

export const D00: DiceMapEntry = {
  displayName: "D%",
  factory(sym, props) {
    return new TrapezohedronD00(sym, props);
  },
};
class TrapezohedronD00 extends TrapezohedronDie implements IDice {
  constructor(symbolSet: DiceSymbolSet, initialProps?: Record<string, number>) {
    super(
      "D00",
      5,
      {
        0: DiceSymbolName.TEN,
        1: DiceSymbolName.SEVENTY,
        2: DiceSymbolName.THIRTY,
        3: DiceSymbolName.FIFTY,
        4: DiceSymbolName.NINETY,
        //
        5: DiceSymbolName.TWENTY,
        6: DiceSymbolName.EIGHTY,
        7: DiceSymbolName.DOUBLE_ZERO,
        8: DiceSymbolName.FORTY,
        9: DiceSymbolName.SIXTY,
      },
      symbolSet,
      initialProps
    );
  }
}

export const RhombicD6: DiceMapEntry = {
  displayName: "D6 Rhombic",
  factory(symbolSet, props) {
    return new TrapezohedronD6(symbolSet, props);
  },
};
class TrapezohedronD6 extends TrapezohedronDie implements IDice {
  constructor(symbolSet: DiceSymbolSet, initialProps?: Record<string, number>) {
    super(
      "D6",
      3,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.THREE,
        2: DiceSymbolName.FIVE,
        3: DiceSymbolName.SIX,
        4: DiceSymbolName.TWO,
        5: DiceSymbolName.FOUR,
      },
      symbolSet,
      initialProps
    );
  }
}

export const D8: DiceMapEntry = {
  displayName: "D8",
  factory(symbolSet, props) {
    return new TrapezohedronD8(symbolSet, props);
  },
};
export class TrapezohedronD8 extends TrapezohedronDie implements IDice {
  constructor(symbolSet: DiceSymbolSet, initialProps?: Record<string, number>) {
    super(
      "D8",
      4,
      {
        0: DiceSymbolName.ONE,
        1: DiceSymbolName.FIVE,
        2: DiceSymbolName.THREE,
        3: DiceSymbolName.SEVEN,
        4: DiceSymbolName.FOUR,
        5: DiceSymbolName.EIGHT,
        6: DiceSymbolName.TWO,
        7: DiceSymbolName.SIX,
      },
      symbolSet,
      initialProps
    );
  }
}
