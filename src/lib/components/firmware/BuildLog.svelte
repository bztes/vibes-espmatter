<script lang="ts">
	import { codeBlock } from '#lib/ui/index.ts';
	let { lines, live = false }: { lines: string[]; live?: boolean } = $props();

	let box = $state<HTMLPreElement>();
	let stick = $state(true);

	$effect(() => {
		void lines.length;
		if (box && stick) box.scrollTop = box.scrollHeight;
	});

	const tone = (line: string) =>
		/(^|\s)(error|failed|✘)/i.test(line)
			? 'text-code-err'
			: /warning|⚠/i.test(line)
				? 'text-code-warn'
				: line.startsWith('──') || line.startsWith('✔')
					? 'text-code-accent font-semibold'
					: '';
</script>

<div class="relative min-w-0">
	<pre
		bind:this={box}
		onscroll={() => box && (stick = box.scrollHeight - box.scrollTop - box.clientHeight < 40)}
		class={codeBlock({
			tone: 'terminal',
			class: 'h-80 rounded-xl p-4 text-[11.5px] leading-[1.55]'
		})}>{#each lines as line, i (i)}<div class={tone(line)}>{line}</div>{:else}<span
				class="text-code-muted">Waiting for the runner…</span
			>{/each}</pre>
	{#if live}<span
			class="absolute top-3 right-4 flex items-center gap-1.5 text-[11px] text-code-muted"
			><span class="size-1.5 animate-pulse rounded-full bg-code-ok"></span>live</span
		>{/if}
</div>
