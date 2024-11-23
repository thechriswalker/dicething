import type { IDice } from "../model/die";
import type { DiceSymbolSet } from "../symbols/symbols";

export type DiceMapEntry = {
  displayName: string;
  displayRotation?: [x: number, y: number];
  displayScale?: number;
  factory(symbolSet: DiceSymbolSet, props: Record<string, number>): IDice;
};
