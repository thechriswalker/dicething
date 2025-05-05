<svelte:head>
	<script type="module">
		const matcher = window.matchMedia('(prefers-color-scheme: dark)');
		let current = localStorage.getItem('light-dark') ?? '';
		window.updateLightDark = function (mode, external = false) {
			const doc = document.documentElement.classList;
			const wasDark = doc.contains('dark');
			let isDark = wasDark;
			switch (mode) {
				case 'light':
					if (current !== mode) {
						localStorage.setItem('light-dark', mode);
					}
					if (wasDark) {
						doc.remove('dark');
					}
					isDark = false;
					break;
				case 'dark':
					if (current !== mode) {
						localStorage.setItem('light-dark', mode);
					}
					if (!wasDark) {
						doc.add('dark');
					}
					isDark = true;
					break;
				default:
					if (current !== mode) {
						localStorage.removeItem('light-dark');
					}
					if (matcher.matches) {
						if (!wasDark) {
							doc.add('dark');
						}
						isDark = true;
					} else {
						console.log('system switch to light mode');
						if (doc.contains('dark')) {
							doc.remove('dark');
						}
						isDark = false;
					}
			}

			if (mode !== current || wasDark !== isDark) {
				const ev = new CustomEvent('light-dark', { detail: mode });
				window.dispatchEvent(ev);
			}
			current = mode;
		};
		window.getLightDark = function () {
			const mode = localStorage.getItem('light-dark') ?? '';
			const isDark = document.documentElement.classList.contains('dark');
			const result = { mode, isDark, isLight: !isDark };
			return result;
		};
		const listener = () => window.updateLightDark(localStorage.getItem('light-dark') ?? '');
		matcher.addEventListener('change', listener);
		window.addEventListener('storage', (ev) => {
			console.log(ev);
			if (ev.storageArea === localStorage && ev.key === 'light-dark') {
				const mode = ev.newValue ?? '';
				window.updateLightDark(mode, true);
			}
		});
		listener();
	</script>
</svelte:head>
