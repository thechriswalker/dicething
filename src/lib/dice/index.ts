import {
  BarrelD00,
  BarrelD10,
  BarrelD12,
  BarrelD4,
  BarrelD6,
  BarrelD8,
} from "./barrels";
import {
  CrystalD00,
  CrystalD10,
  CrystalD12,
  CrystalD4,
  CrystalD6,
  CrystalD8,
} from "./crystals";
import { D6 } from "./cube";
import { D12, Rhombic12 } from "./dodecahedron";
import { D20 } from "./icosahedron";
import { D10, D00, RhombicD6, D8 } from "./trapezohedron";

// the keys here are used to identify the "kind" of die, when loading from JSON.

const diceMap = {
  /*
   * D4 variants - no caltrops!
   */
  d4_crystal: CrystalD4, // d4 with a teardrop shape. an uneven regular d8
  d4_barrel: BarrelD4, // @TODO // d4 with a barrel shape, i.e. the "lozenge" style

  /*
   * D6 variants
   */
  d6_cube: D6, // regular cube
  d6_rhombic: RhombicD6, // the trapzohedron d6
  d6_barrel: BarrelD6, // @TODO! // a six-sided cone, with pyramidal end caps
  d6_crystal: CrystalD6, // a six-sided teardrop

  /*
   * D8 variants
   */
  d8_octahedron: D8, // the regular one
  d8_barrel: BarrelD8, // @TODO! // eight sided lozenge
  d8_crystal: CrystalD8, // @TODO! // eight-sided teardrop

  /*
   * D10 Variants
   */
  d10_dipyramid: D10, // normal d10 antidipyramid
  d10_barrel: BarrelD10, // @TODO! // 10-sided barrel
  d10_crystal: CrystalD10, // @TODO!/ 10-sided teardrop

  /*
   * D100 / D% Variants
   */
  d00_dipyramid: D00, // normal d10 antidipyramid
  d00_barrel: BarrelD00, // @TODO! // 10-sided barrel
  d00_crystal: CrystalD00, // @TODO!/ 10-sided teardrop

  /*
   * D12 Variants
   */
  d12_dodecahedron: D12, // @TODO, normal D12
  d12_rhombic: Rhombic12, // @TODO rhombic dodecahedron, (remember points of a cube, and inverted pyramids on each side)
  d12_barrel: BarrelD12, //@TODO 12 sided barrel - is this still worth offering?
  d12_crystal: CrystalD12, // @TODO 12 sided teardrop shape

  /*
   * D20 variants - or is there just one...
   */
  d20_icosahedron: D20, // @TODO - normal d20 shape

  // other die?
} as const;

export default diceMap;

export type DiceKind = keyof typeof diceMap;
