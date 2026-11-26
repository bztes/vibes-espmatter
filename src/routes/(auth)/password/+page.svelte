<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import PasswordForm from '#lib/components/PasswordForm.svelte';
	import { getPasswordChange, signOut } from '#lib/remote/auth.remote.ts';
	import { Button } from '#lib/ui/index.ts';

	const who = $derived(await getPasswordChange());
	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '/');
</script>

<svelte:head><title>Choose your password – espmatter studio</title></svelte:head>

{#if who}
	<h1 class="mt-0 mb-1 text-lg font-semibold">Choose your password</h1>
	<p class="mt-0 mb-5 text-sm text-muted">
		<strong class="text-fg">{who.email}</strong> signed in with a generated password. Set your own to
		continue.
	</p>
	<PasswordForm email={who.email} {redirectTo} generated />
	<div class="mt-4 text-center text-sm text-muted">
		<form {...signOut}>
			<Button type="submit" variant="link">Sign out</Button>
		</form>
	</div>
{:else}
	<p class="m-0 text-sm">Your session ended. <a href={resolve('/(auth)/login')}>Sign in</a></p>
{/if}
