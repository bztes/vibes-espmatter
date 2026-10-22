<script lang="ts">
	import { page } from '$app/state';
	import { getSignUpOpen, signIn, signUp } from '#lib/api/auth.remote.ts';
	import { Button, Input, PasswordInput } from '#lib/device/device-ui/ui/index.ts';

	// Only the first account can be created; after that there is just sign-in.
	const mode = $derived<'signin' | 'signup'>((await getSignUpOpen()) ? 'signup' : 'signin');
	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '/');
	const form = $derived(mode === 'signin' ? signIn : signUp);
</script>

<svelte:head>
	<title>{mode === 'signin' ? 'Sign in' : 'Create account'} – vibes-espmatter</title>
</svelte:head>

{#snippet issues(list: { message: string }[] | undefined)}
	{#each list ?? [] as issue (issue.message)}<p class="mt-2 text-sm text-err">
			{issue.message}
		</p>{/each}
{/snippet}

<div class="mx-auto max-w-96 px-4 pt-16 pb-6">
	<h1 class="m-0">{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
	<p class="mt-1 mb-0 text-xs text-muted">
		{mode === 'signin'
			? 'Sign in to see and save your devices.'
			: 'No account exists yet – create the one for this server.'}
	</p>

	{#key mode}
		<form class="mt-5" {...form}>
			<Input {...form.fields.redirectTo.as('hidden', redirectTo)} />
			{#if mode === 'signup'}
				<Input label="Name" autocomplete="name" {...signUp.fields.name.as('text')} />
				{@render issues(signUp.fields.name.issues())}
			{/if}
			<Input label="Email" autocomplete="email" {...form.fields.email.as('email')} />
			{@render issues(form.fields.email.issues())}
			<PasswordInput
				label="Password"
				autocomplete={mode === 'signin' ? 'current-password' : 'new-password'}
				{...form.fields._password.as('password')}
			/>
			{@render issues(form.fields._password.issues())}
			{@render issues(form.fields.allIssues()?.filter((i) => !i.path?.length))}
			<Button type="submit" variant="primary" class="mt-1 w-full" disabled={!!form.pending}>
				{mode === 'signin' ? 'Sign in' : 'Create account'}
			</Button>
		</form>
	{/key}
</div>
