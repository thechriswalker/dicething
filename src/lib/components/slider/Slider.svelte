<script lang="ts">
	import { Slider } from "@skeletonlabs/skeleton-svelte";

    let { value, onChange, min, max, step, class: classes = "" }: { class?: string; min: number, max: number; step: number; value: number; onChange: (v: number) => void } = $props()

</script>
<Slider defaultValue={[value]} onValueChange={(e) => onChange(e.value[0])} {min} {max} {step} class={classes}>
		<Slider.Control>
			<Slider.Track class="bg-primary-50-950">
				<Slider.Range class="bg-primary-500" />
			</Slider.Track>
			<Slider.Thumb index={0} class="ring-primary-500">
				<Slider.HiddenInput />
			</Slider.Thumb>
		</Slider.Control>
	</Slider>