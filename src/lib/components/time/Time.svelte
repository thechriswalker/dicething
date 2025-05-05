<script lang="ts">
	const defaultFmtOptions: Intl.DateTimeFormatOptions = {
		dateStyle: 'medium',
		timeStyle: 'short'
	};

	interface Props {
		fmt?: Intl.DateTimeFormatOptions;
		t: number | string | Date;
		class?: string;
	}

	let { class: classes = '', t, fmt = defaultFmtOptions }: Props = $props();

	let dateFormatter = $derived(Intl.DateTimeFormat(undefined, fmt));
	let d = $derived(t instanceof Date ? t : new Date(t));

	let dateString = $derived(dateFormatter.format(d));
</script>

<time class={classes} datetime={d.toISOString()}>{dateString}</time>
