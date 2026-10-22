<!-- Monospace output (a log, or a file as `text`). With `follow` it stays scrolled to the end unless scrolled up. -->
<script lang="ts">
	let {
		lines = [],
		text,
		follow = true,
		height = 300,
		empty = ''
	}: {
		lines?: string[];
		/** Shown instead of `lines`. */
		text?: string;
		follow?: boolean;
		/** Height in px. */
		height?: number;
		/** Shown while there are no lines. */
		empty?: string;
	} = $props();

	let pre = $state<HTMLPreElement>();
	/** False while scrolled up away from the end. */
	let atEnd = true;

	function toEnd() {
		if (follow && atEnd && pre) pre.scrollTop = pre.scrollHeight;
	}

	$effect(() => {
		void lines.length;
		toEnd();
	});

	// Also when it becomes visible (e.g. in a dialog that just opened).
	$effect(() => {
		if (!pre) return;
		const observer = new ResizeObserver(toEnd);
		observer.observe(pre);
		return () => observer.disconnect();
	});

	function onscroll() {
		if (pre?.clientHeight) atEnd = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 8;
	}
</script>

<pre
	bind:this={pre}
	class="m-0 overflow-auto rounded-lg bg-[#0b1020] p-3 font-mono text-2xs leading-[1.45] text-[#cbd5e1]"
	style:height="{height}px"
	{onscroll}>{text ?? (lines.join('\n') || empty)}</pre>
