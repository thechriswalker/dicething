import { Shape, type ShapeJSON } from "three";
import { Font, type FontData, FontLoader } from "three/examples/jsm/Addons.js";
import { defaultFont } from "./font";

export type DiceSymbol = {
  readonly shapes: Shape[];
  toJSON: () => SymbolConfig;
};

export function isBlank(sym: DiceSymbol) {
  return sym.shapes.length == 0;
}

export const BlankSymbol = shapesSymbol([]);

// font symbol has a custom JSON serialisation
export function fontSymbol(font: Font, text: string): DiceSymbol {
  return {
    shapes: font.generateShapes(text, 10),
    toJSON() {
      return text;
    },
  };
}

export function shapesSymbol(shapes: Array<Shape>): DiceSymbol {
  return {
    shapes,
    toJSON() {
      return { shapes: shapes.map((s) => s.toJSON()) };
    },
  };
}

export enum DiceSymbolName {
  BLANK = -1,
  ZERO = 0,
  ONE = 1,
  TWO = 2,
  THREE = 3,
  FOUR = 4,
  FIVE = 5,
  SIX = 6,
  SEVEN = 7,
  EIGHT = 8,
  NINE = 9,
  TEN = 10,
  ELEVEN = 11,
  TWELVE = 12,
  THIRTEEN = 13,
  FOURTEEN = 14,
  FIFTEEN = 15,
  SIXTEEN = 16,
  SEVENTEEN = 17,
  EIGHTEEN = 18,
  NINETEEN = 19,
  TWENTY = 20,
  SIX_MARKED = 21, // i.e. underline or with a dot
  NINE_MARKED = 22, // i.e. underline or with a dot
  THIRTY = 23,
  FORTY = 24,
  FIFTY = 25,
  SIXTY = 26,
  SEVENTY = 27,
  EIGHTY = 28,
  NINETY = 29,
  DOUBLE_ZERO = 30,
  // and 34 slots for custom stuff..
  CUSTOM_SYMBOLS_START = 31,
}

// this is a boring function, but useful for debugging...
export function debugSymbolName(n: DiceSymbolName): string {
  switch (n) {
    case DiceSymbolName.BLANK:
      return "BLANK";
    case DiceSymbolName.ZERO:
      return "ZERO";
    case DiceSymbolName.ONE:
      return "ONE";
    case DiceSymbolName.TWO:
      return "TWO";
    case DiceSymbolName.THREE:
      return "THREE";
    case DiceSymbolName.FOUR:
      return "FOUR";
    case DiceSymbolName.FIVE:
      return "FIVE";
    case DiceSymbolName.SIX:
      return "SIX";
    case DiceSymbolName.SEVEN:
      return "SEVEN";
    case DiceSymbolName.EIGHT:
      return "EIGHT";
    case DiceSymbolName.NINE:
      return "NINE";
    case DiceSymbolName.TEN:
      return "TEN";
    case DiceSymbolName.ELEVEN:
      return "ELEVEN";
    case DiceSymbolName.TWELVE:
      return "TWELVE";
    case DiceSymbolName.THIRTEEN:
      return "THIRTEEN";
    case DiceSymbolName.FOURTEEN:
      return "FOURTEEN";
    case DiceSymbolName.FIFTEEN:
      return "FIFTEEN";
    case DiceSymbolName.SIXTEEN:
      return "SIXTEEN";
    case DiceSymbolName.SEVENTEEN:
      return "SEVENTEEN";
    case DiceSymbolName.EIGHTEEN:
      return "EIGHTEEN";
    case DiceSymbolName.NINETEEN:
      return "NINETEEN";
    case DiceSymbolName.TWENTY:
      return "TWENTY";
    case DiceSymbolName.SIX_MARKED:
      return "SIX_MARKED";
    case DiceSymbolName.NINE_MARKED:
      return "NINE_MARKED";
    case DiceSymbolName.THIRTY:
      return "THIRTY";
    case DiceSymbolName.FORTY:
      return "FORTY";
    case DiceSymbolName.FIFTY:
      return "FIFTY";
    case DiceSymbolName.SIXTY:
      return "SIXTY";
    case DiceSymbolName.SEVENTY:
      return "SEVENTY";
    case DiceSymbolName.EIGHTY:
      return "EIGHTY";
    case DiceSymbolName.NINETY:
      return "NINETY";
    case DiceSymbolName.DOUBLE_ZERO:
      return "DOUBLE_ZERO";
  }
  return `CUSTOM_SYMBOL_(${n})`;
}

export const AllBlanks: DiceSymbolSet = {
  getSymbol(n) {
    return BlankSymbol;
  },
  setSymbol(n, s) {
    throw new Error("cannot change this set");
  },
  toJSON() {
    return { symbols: [] };
  },
};

export type DiceSymbolSet = {
  getSymbol(n: number): DiceSymbol;
  setSymbol(n: number, s: DiceSymbol): void;
  toJSON(): SymbolSetConfig;
};

export type SymbolSetConfig = {
  font?: FontData; // the typeface.json, could be a minimal variant with just `0123456789.`
  // the symbols are in order, the indices are those from `src/symbols/symbols.ts`, basically 0-30.
  // any extras are added to the SymbolSet from 31 onwards.
  symbols: Array<SymbolConfig>;
};

// config for a single symbol
export type SymbolConfig =
  | { shapes: Array<ShapeJSON> } // Three.js JSON serialised "Shapes" array, for custom shape based symbols
  | string; // text from the font.

export function symbolSetFromJSON(obj: SymbolSetConfig): DiceSymbolSet {
  let font: Font;
  if (obj.font) {
    font = new FontLoader().parse(obj.font);
  } else {
    font = defaultFont;
  }

  const defined = new Map<number, DiceSymbol>();

  for (let i = 0; i < obj.symbols.length; i++) {
    const s = obj.symbols[i];
    if (typeof s === "string") {
      defined.set(i, fontSymbol(font, s));
    } else if ("shapes" in s && Array.isArray(s.shapes)) {
      defined.set(
        i,
        shapesSymbol(s.shapes.map((ss) => new Shape().fromJSON(ss)))
      );
    } else {
      throw new Error("invalid symbol definition");
    }
  }

  return {
    getSymbol(n: number): DiceSymbol {
      return defined.get(n) ?? BlankSymbol;
    },
    setSymbol(n, s) {
      defined.set(n, s);
    },
    toJSON(): SymbolSetConfig {
      // find the "max" symbol, the sorting is numeric to ensure the last element
      // has the largest value.
      const largestIndex = [...defined.keys()].sort((a, z) => a - z).pop() ?? 0;
      return {
        font: obj.font ?? defaultFont.data,
        symbols: Array.from({ length: largestIndex }).map((_, i) => {
          return (defined.get(i) ?? BlankSymbol).toJSON();
        }),
      };
    },
  };
}

// should really do this in place...
export function switchFont(newFont: Font, sym: DiceSymbolSet): DiceSymbolSet {
  sym.toJSON().symbols.forEach((s, i) => {
    console.log("updating symbol", i, s);
    if (typeof s === "string") {
      sym.setSymbol(i, fontSymbol(newFont, s));
    }
  });

  (sym as any).font = newFont.data;
  return sym;
}

// we re-create it each time, so it can be
// modified in place.
export const defaultSymbolSet = () => {
  return symbolSetFromJSON({
    symbols: (
      "0 1 2 3 4 5 6 7 8 9 10 " +
      "11 12 13 14 15 16 17 18 19 20 " +
      "6. 9. 30 40 50 60 70 80 90 00"
    ).split(" "),
  });
};
