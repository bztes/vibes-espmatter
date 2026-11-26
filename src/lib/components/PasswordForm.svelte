<!-- Change the own password (`changePassword`); `generated`: the current one was generated. -->
<script lang="ts">
	import { changePassword } from '#lib/remote/auth.remote.ts';
	import { Button, Field, Input } from '#lib/ui/index.ts';

	let {
		email,
		redirectTo,
		generated = false,
		class: className = ''
	}: { email: string; redirectTo: string; generated?: boolean; class?: string } = $props();

	const { _current, _password, _confirm } = changePassword.fields;
</script>

<form {...changePassword} class={['grid gap-4', className]}>
	<input {...changePassword.fields.redirectTo.as('hidden', redirectTo)} />
	<input type="email" autocomplete="username" value={email} hidden readonly />
	<Field
		label={generated ? 'Generated password' : 'Current password'}
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
