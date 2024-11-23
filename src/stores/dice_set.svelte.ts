import { Shape } from "three";
import LocalStorageState from "../lib/localstorage.svelte";
import type { DiceKind } from "../lib/dice";

export type DiceSetState = {
  name: string;
  dice: Array<DieState>;
};

export type DieState = {
  name: string;
  shape: DiceKind; // keyof typeof dice constructors
  props: Record<string, number>; // dice shape props
  legends: Array<LegendState>; // the legends
};

export type LegendState = {
  legend: number; // DiceSymbolName: 0-64
  transforms: Partial<LegendTransform>;
};

export type LegendTransform = {
  offsetX: number;
  offsetY: number;
  scale: number; // no x/y scaling.
  rotation: number; // radians.
};

export const diceSetState = () =>
  new LocalStorageState<DiceSetState>("dt:dice", {
    name: "New Set",
    dice: [],
  });

export const legendSetState = () =>
  new LocalStorageState<LegendSetState>("dt:legends", {
    name: "Blanks",
    symbols: [],
  });

export type LegendSetState = {
  name: string;
  symbols: Array<Shape>; // up-to 64 element array,
};
