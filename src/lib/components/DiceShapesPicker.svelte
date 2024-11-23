<script lang="ts">
  import diceMap, { type DiceKind } from "../dice";
  import { getImagePreview } from "../dice/previews";

  const { selected = $bindable([]) }: { selected: Array<DiceKind> } = $props();

  const options = Object.keys(diceMap).map((k) => {
    const key = k as DiceKind;
    return {
      key,
      name: diceMap[key].displayName,
    };
  });

  function toggle(key: DiceKind, on: boolean) {
    const idx = selected.findIndex((k) => k === key);
    if (idx === -1 && on) {
      selected.push(key);
    } else if (idx > -1 && !on) {
      selected.splice(idx, 1);
    }
  }
</script>

<div class="block">
  <div class="grid dice_grid">
    {#each options as opt}
      <div class="cell">
        <input
          type="checkbox"
          onchange={(ev) =>
            toggle(opt.key, (ev.target as HTMLInputElement).checked)}
          checked={selected.includes(opt.key)}
          name={opt.key}
          id={opt.key}
        />
        <label for={opt.key}>
          {opt.name}
          <img src={getImagePreview(opt.key)} alt={opt.key} />
        </label>
      </div>
    {/each}
  </div>
</div>

<style>
  input[type="checkbox"] {
    display: none;
  }
  label {
    display: block;
    text-align: center;
    padding: 1rem;
    border-radius: 0.5rem;
  }
  input:checked + label {
    outline: 2px solid lightseagreen;
  }
  img {
    width: 128px;
    height: 128px;
  }
</style>
