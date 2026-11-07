<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { changePassword, getPasswordChange, signOut } from '#lib/remote/auth.remote.ts';
	import { Button, Field, Input } from '#lib/ui/index.ts';

	const who = $derived(await getPasswordChange());
	const redirectTo = $derived(page.url.searchParams.get('redirectTo') ?? '/');
	const { _current, _password, _confirm } = changePassword.fields;
</script>

<svelte:head><title>Change password – espmatter studio</title></svelte:head>

{#if who}
	<h1 class="mt-0 mb-1 text-lg font-semibold">
		{who.forced ? 'Choose your password' : 'Change password'}
	</h1>
	<p class="mt-0 mb-5 text-sm text-muted">
		{#if who.forced}
			<strong class="text-fg">{who.email}</strong> signed in with a generated password. Set your own to
			continue.
		{:else}
			For <strong class="text-fg">{who.email}</strong>. Your other sessions are signed out.
		{/if}
	</p>
	<form {...changePassword} class="grid gap-4">
		<input {...changePassword.fields.redirectTo.as('hidden', redirectTo)} />
		<input type="email" autocomplete="username" value={who.email} hidden readonly />
		<Field
			label={who.forced ? 'Generated password' : 'Current password'}
			id="current"
			error={_current.issues()?.[0]?.message}
		>
			<Input
				id="current"
				autocomplete="current-password"
				invalid={!!_current.issues()}
				{..._current.as('password')}
			/>
		</Field>
		<Field label="New password" id="new" error={_password.issues()?.[0]?.message}>
			<Input
				id="new"
				autocomplete="new-password"
				invalid={!!_password.issues()}
				{..._password.as('password')}
			/>
		</Field>
		<Field label="Repeat new password" id="confirm" error={_confirm.issues()?.[0]?.message}>
			<Input
				id="confirm"
				autocomplete="new-password"
				invalid={!!_confirm.issues()}
				{..._confirm.as('password')}
			/>
		</Field>
		{#each changePassword.fields
			.allIssues()
			?.filter((i) => !i.path?.length) ?? [] as issue (issue.message)}
			<p class="m-0 text-sm text-err">{issue.message}</p>
		{/each}
		<Button type="submit" variant="primary" disabled={!!changePassword.pending}
			>{changePassword.pending ? 'Saving…' : 'Save password'}</Button
		>
	</form>
	<div class="mt-4 text-center text-sm text-muted">
		{#if who.forced}
			<form {...signOut}>
				<Button type="submit" variant="link">Sign out</Button>
			</form>
		{:else}
			<a href={resolve('/(app)')}>Cancel</a>
		{/if}
	</div>
{:else}
	<p class="m-0 text-sm">Your session ended. <a href={resolve('/(auth)/login')}>Sign in</a></p>
{/if}
