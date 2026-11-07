<script lang="ts">
	import { resolve } from '$app/paths';
	import { getSignUp, signUp } from '#lib/remote/auth.remote.ts';
	import { Button, Field, Input, Notice } from '#lib/ui/index.ts';

	const status = $derived(await getSignUp());
	const { name, email, _password } = signUp.fields;
</script>

<svelte:head><title>Create account – espmatter studio</title></svelte:head>

<h1 class="mt-0 mb-1 text-lg font-semibold">
	{status.first ? 'Create the admin account' : 'Create an account'}
</h1>
{#if status.first}
	<p class="mt-0 mb-4 text-sm text-muted">
		This account manages users and build runners. You can invite others later.
	</p>
{/if}

{#if !status.open}
	<div class="mt-4">
		<Notice tone="warn">Sign-up is closed. Ask an admin for an account.</Notice>
	</div>
	<p class="mt-4 mb-0 text-center text-sm">
		<a href={resolve('/(auth)/login')}>Back to sign in</a>
	</p>
{:else}
	<form {...signUp} class="mt-4 grid gap-4">
		<Field label="Name" id="name" error={name.issues()?.[0]?.message}>
			<Input id="name" autocomplete="name" invalid={!!name.issues()} {...name.as('text')} />
		</Field>
		<Field label="Email" id="email" error={email.issues()?.[0]?.message}>
			<Input id="email" autocomplete="email" invalid={!!email.issues()} {...email.as('email')} />
		</Field>
		<Field
			label="Password"
			id="password"
			help="At least 8 characters."
			error={_password.issues()?.[0]?.message}
		>
			<Input
				id="password"
				autocomplete="new-password"
				invalid={!!_password.issues()}
				{..._password.as('password')}
			/>
		</Field>
		{#each signUp.fields.allIssues()?.filter((i) => !i.path?.length) ?? [] as issue (issue.message)}
			<p class="m-0 text-sm text-err">{issue.message}</p>
		{/each}
		<Button type="submit" variant="primary" disabled={!!signUp.pending}>Create account</Button>
	</form>
	{#if !status.first}<p class="mt-4 mb-0 text-center text-sm text-muted">
			Have an account? <a href={resolve('/(auth)/login')}>Sign in</a>
		</p>{/if}
{/if}
