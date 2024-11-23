<script lang="ts">
  import type { DieState } from "../../stores/dice_set.svelte";
  import diceMap from "../dice";
  import type { DiePropertyDescriptor, IDice } from "../model/die";
  import { createScene, type DiceScene } from "../scene";
  import type { DiceSymbolSet } from "../symbols/symbols";

  // This component is the main editor for a die.
  // it takes a "DiceConfig" - turns it into a IDice instance,
  // creates an renders a "scene" with it, providing controls for
  // interactively updating the model.
  // It provides a "save" function to re-serialise the die,
  // and and emits a "save" event with the new JSON-able - object
  // when clicked.
  //
  // the only other prop required is the symbolSet
  // on a change of symbolSet, we will need to update our dice.
  const {
    symbolSet,
    dieConfig,
  }: {
    symbolSet: DiceSymbolSet;
    dieConfig: DieState;
  } = $props();
  import { Mesh, MeshNormalMaterial } from "three";
  import { onMount } from "svelte";

  let viewPort: HTMLDivElement;
  let scene: DiceScene;
  let die: IDice;

  let properties = $state([] as Array<DiePropertyDescriptor>);

  let currentDiceProps = $state({} as Record<string, number>);
  const _m = new MeshNormalMaterial({ flatShading: true });

  $effect(() => {
    console.log("props", currentDiceProps);
    die?.setProperties(currentDiceProps);
    scene?.setDiceFaces(die?.getFaces().map((f) => new Mesh(f, _m)));
  });

  onMount(() => {
    // create a scene!
    scene = createScene(viewPort);

    // load the dice config
    die = diceMap[dieConfig.shape].factory(symbolSet, dieConfig.props);
    properties = die.listAvailableProperties();
    currentDiceProps = die.getProperties();

    scene.setDiceFaces(die.getFaces().map((f) => new Mesh(f, _m)));

    return () => {
      // teardown the scene.
      // really we should dispose() of
      // all the geometries...
      scene?.dispose();
    };
  });
</script>

<div>
  <div class="viewport" bind:this={viewPort}></div>
  <div class="property_editor">
    <ul>
      {#each properties as p}
        <li>
          <p><b>{p.name}</b> {p.description} ({currentDiceProps[p.key]})</p>
          <p>
            <input
              type="range"
              min={p.bounds[0]}
              max={p.bounds[1]}
              step={p.step ?? 1}
              bind:value={currentDiceProps[p.key]}
            />
          </p>
        </li>
      {/each}
    </ul>
  </div>
</div>

<style>
  .viewport {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
  }
  .property_editor {
    position: absolute;
    top: 0;
    right: 0;
    z-index: 1; /* just to push higher than the viewport */
  }
</style>
