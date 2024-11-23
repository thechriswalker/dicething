<script lang="ts">
  import DiceEditor from "./lib/components/DiceEditor.svelte";
  import DiceShapesPicker from "./lib/components/DiceShapesPicker.svelte";
  import type { DiceKind } from "./lib/dice";
  import diceMap from "./lib/dice";
  import { defaultSymbolSet } from "./lib/symbols/symbols";

  // we need to only add the elements we want, or we will block UI events on the viewport.

  import {
    diceSetState,
    legendSetState,
    type DieState,
  } from "./stores/dice_set.svelte";

  const diceSet = diceSetState();
  const legendSet = legendSetState();
  let initialDiceSelection: Array<DiceKind> = [
    "d4_crystal",
    "d6_cube",
    "d8_octahedron",
    "d10_dipyramid",
    "d00_dipyramid",
    "d12_dodecahedron",
    "d20_icosahedron",
  ];

  const symbolSet = defaultSymbolSet();

  let shape: DiceKind = "d20_icosahedron";
  const symbolInURL = new URLSearchParams(window.location.search).get("d");
  if (symbolInURL && symbolInURL in diceMap) {
    shape = symbolInURL as DiceKind;
  }

  const dieConfig: DieState = {
    name: "Testing Die",
    shape,
    props: {
      width: 20,
    },
    legends: [],
  };
</script>

<main>
  <DiceEditor {symbolSet} {dieConfig} />
</main>
