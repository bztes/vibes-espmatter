<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { getSignUp, signIn } from '#lib/remote/auth.remote.ts';
	import { Button, button, Field, Input } from '#lib/ui/index.ts';

	const signUp = $derived(await getSignUp());
	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '/');
	const { email, _password } = signIn.fields;
</script>

<svelte:head><title>Sign in – espmatter studio</title></svelte:head>

{#if signUp.first}
	<h1 class="mt-0 mb-1 text-lg font-semibold">Welcome</h1>
	<p class="mt-0 mb-4 text-sm text-muted">
		There’s no account yet. The first one administers this server.
	</p>
	<a
		href={resolve('/(auth)/signup')}
		class={button({ variant: 'primary', class: 'w-full no-underline' })}>Create the admin account</a
	>
{:else}
	<h1 class="mt-0 mb-5 text-lg font-semibold">Sign in</h1>
	<form {...signIn} class="grid gap-4">
		<input {...signIn.fields.redirectTo.as('hidden', redirectTo)} />
		<Field label="Email" id="email" error={email.issues()?.[0]?.message}>
			<Input id="email" autocomplete="email" invalid={!!email.issues()} {...email.as('email')} />
		</Field>
		<Field label="Password" id="password" error={_password.issues()?.[0]?.message}>
			<Input
				id="password"
				autocomplete="current-password"
				invalid={!!_password.issues()}
				{..._password.as('password')}
			/>
		</Field>
		{#each signIn.fields.allIssues()?.filter((i) => !i.path?.length) ?? [] as issue (issue.message)}
			<p class="m-0 text-sm text-err">{issue.message}</p>
		{/each}
		<Button type="submit" variant="primary" disabled={!!signIn.pending}
			>{signIn.pending ? 'Signing in…' : 'Sign in'}</Button
		>
	</form>
	{#if signUp.open}
		<p class="mt-4 mb-0 text-center text-sm text-muted">
			No account? <a href={resolve('/(auth)/signup')}>Create one</a>
		</p>
	{/if}
{/if}
