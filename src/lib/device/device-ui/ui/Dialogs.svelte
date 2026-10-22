<!-- Shows the requests of showAlert/showConfirm/showPrompt (dialogs.svelte.ts). Mount it once per app. -->
<script lang="ts">
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Input from './Input.svelte';
	import { queue } from './dialogs.svelte.ts';

	let dialog = $state<ReturnType<typeof Dialog>>();
	const current = $derived(queue[0]);
	/** Submitted rather than cancelled (Cancel, Esc). */
	let ok = false;

	$effect(() => {
		if (current) dialog?.open();
	});

	function submit(ev: SubmitEvent) {
		ev.preventDefault();
		ok = true;
		dialog?.close();
	}

	function closed() {
		const req = queue.shift();
		if (req?.kind === 'prompt') req.resolve(ok ? req.value : null);
		else if (req?.kind === 'confirm') req.resolve(ok);
		else req?.resolve();
		ok = false;
	}
</script>

<Dialog bind:this={dialog} width={420} onclose={closed}>
	{#if current}
		<form class="grid gap-3 [&_label]:m-0" onsubmit={submit}>
			<h2 class="m-0 text-md">{current.title}</h2>
			{#if current.kind === 'prompt'}
				<Input label={current.message} bind:value={current.value} />
			{:else}
				<p class="m-0 whitespace-pre-line">{current.message}</p>
			{/if}
			<div class="mt-1 flex justify-end gap-2">
				{#if current.kind !== 'alert'}
					<Button onclick={() => dialog?.close()}>Cancel</Button>
				{/if}
				<Button
					type="submit"
					variant={current.kind === 'confirm' && current.danger ? 'danger' : 'primary'}
					>{current.kind === 'confirm' ? current.action : 'OK'}</Button
				>
			</div>
		</form>
	{/if}
</Dialog>
