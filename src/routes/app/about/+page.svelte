<script lang="ts">
	import Layout from '$lib/components/layout/Layout.svelte';
	import { PUBLIC_APP_COMMIT, PUBLIC_APP_REPO_URL, PUBLIC_APP_VERSION } from '$env/static/public';
	import { Github, MessageCircleQuestion } from '@lucide/svelte';

	let thanks = [
		{
			title: 'DiceMaker',
			link: 'https://ankhe.itch.io/dicemaker',
			desc: "The original DiceMaker was and is an excellent tool, and I don't think I would have considered making this if not for it."
		},
		{
			title: 'three.js',
			link: 'https://threejs.org',
			desc: 'Three.js provides the awesome 3D rendering capabilities I needed to create custom dice models.'
		},
		{
			title: 'Svelte(Kit)',
			link: 'https://svelte.dev/',
			desc: 'The web frontend framework that powers this frontend'
		}
	];
</script>

<Layout>
	<div class="mx-auto w-full max-w-3xl px-2 py-6">
		<div class="card preset-filled-surface-100-900 space-y-4 p-4">
			<h1 class="h1 flex items-center gap-4">
				<MessageCircleQuestion class="icon-text" />
				About
			</h1>

			<p>DiceThing is a tool for creating custom dice models suitable for printing.</p>
			<p>
				It is highly inspired by a tool called <a href="https://ankhe.itch.io/dicemaker">DiceMaker</a>
				which is desktop application that does pretty much the same thing as this tool.
			</p>
			<p>There were two main reasons for me starting work on DiceThing:</p>
			<ol class="ms-4 list-inside list-decimal space-y-2">
				<li>
					I believed the functionality could be provided as a web-app without the need for a desktop
					application and the associated packaging requirements.
				</li>
				<li>
					I wanted to add some shape options and features to DiceMaker, but it is not open source so I
					couldn't contribute to the existing project.
				</li>
			</ol>
			<p>
				If this project ever gets feature parity with DiceMaker, then hopefully collaborators will add
				improvements over time.
			</p>
			<p>@todo: add feature comparison table...</p>

			<h2 class="h2 pt-4">Build</h2>
			<dl class="space-y-1">
				<div>
					<dt class="inline font-bold">Version:</dt>
					<dd class="inline">{PUBLIC_APP_VERSION}</dd>
				</div>
				<div>
					<dt class="inline font-bold">Commit:</dt>
					<dd class="inline font-mono">{PUBLIC_APP_COMMIT}</dd>
				</div>
			</dl>
			<p>
				<a
					href={PUBLIC_APP_REPO_URL}
					class="btn preset-filled-primary-500 inline-flex flex-row items-center gap-1"
				>
					<Github class="icon-text" />
					Source on GitHub
				</a>
			</p>

			<h2 class="h2 pt-4">Thanks...</h2>
			<p>This project would not have been possible without the following prior work:</p>
			<dl class="space-y-4">
				{#each thanks as t}
					<div>
						<dt class="font-bold">
							{t.title}
							<small class="opacity-60"><a href={t.link}>{t.link}</a></small>
						</dt>
						<dd>
							<p>{t.desc}</p>
						</dd>
					</div>
				{/each}
			</dl>
		</div>
	</div>
</Layout>