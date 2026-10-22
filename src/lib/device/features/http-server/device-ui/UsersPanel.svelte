<!--
	All logins (espm_auth.cpp): admins, and users who may only use what other features give them
	(e.g. the lights the Matter controller gives them, in its own panel).
-->
<script lang="ts">
	import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import ShieldOff from '@lucide/svelte/icons/shield-off';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { tick } from 'svelte';
	import { api, errorMessage, generatePassword } from '../../web-ui/device-ui/api';
	import { live } from '../../web-ui/device-ui/live.svelte';
	import Menu from '../../../device-ui/Menu.svelte';
	import Panel from '../../web-ui/device-ui/Panel.svelte';
	import { Alert, Badge, Button, Dialog, Input, Select, showConfirm } from '../../../device-ui/ui';

	type Role = 'admin' | 'user';
	interface User {
		name: string;
		role: Role;
		mustChangePassword: boolean;
	}

	const users = live<{ me: string; max: number; users: User[] }>('/api/users', 60_000);

	let newName = $state('');
	let newRole = $state<Role>('user');
	let newDialog = $state<Dialog>();
	/** The new-user dialog is open (its errors show there, not in the panel). */
	let creating = $state(false);

	function openNew() {
		newName = '';
		error = '';
		creating = true;
		newDialog?.open();
	}
	/** A password set by the admin, shown once so it can be handed over. */
	let handOver = $state<{ user: string; password: string } | null>(null);
	let handOverBox = $state<HTMLElement>();

	async function showPassword(user: string, password: string) {
		handOver = { user, password };
		await tick();
		handOverBox?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}
	let error = $state('');
	let busy = $state(false);

	async function call(body: Record<string, string>) {
		busy = true;
		error = '';
		try {
			await api('/api/users', { body });
			await users.refresh();
			return true;
		} catch (e) {
			error = errorMessage(e);
			return false;
		} finally {
			busy = false;
		}
	}

	async function add(ev: SubmitEvent) {
		ev.preventDefault();
		const user = newName.trim();
		const password = generatePassword();
		const ok = await call({ op: 'add', name: user, role: newRole, password });
		if (ok) {
			newDialog?.close();
			showPassword(user, password);
		}
	}

	async function resetPassword(user: User) {
		const ok = await showConfirm(
			'Reset password',
			`Set a new password for ${user.name}? They are logged out everywhere.`,
			{ action: 'Reset password' }
		);
		if (!ok) return;
		const password = generatePassword();
		if (await call({ op: 'set', name: user.name, password })) {
			showPassword(user.name, password);
		}
	}

	function setRole(user: User, role: Role) {
		call({ op: 'set', name: user.name, role });
	}

	async function remove(user: User) {
		const ok = await showConfirm(
			'Delete user',
			`Delete ${user.name}? They are logged out immediately.`,
			{
				action: 'Delete',
				danger: true
			}
		);
		if (ok) {
			call({ op: 'delete', name: user.name });
		}
	}

	function actions(user: User) {
		const self = user.name === users.data?.me;
		return [
			{ label: 'Reset password', icon: KeyRound, onclick: () => resetPassword(user) },
			user.role === 'admin'
				? {
						label: 'Make user',
						icon: ShieldOff,
						onclick: () => setRole(user, 'user'),
						disabled: self
					}
				: { label: 'Make admin', icon: ShieldCheck, onclick: () => setRole(user, 'admin') },
			{ label: 'Delete', icon: Trash2, onclick: () => remove(user), danger: true, disabled: self }
		];
	}
</script>

<Panel title="Users">
	{#snippet badge()}
		{#if users.data && users.data.users.length < users.data.max}
			<Button variant="link" onclick={openNew}>New user</Button>
		{/if}
	{/snippet}
	{#if handOver}
		<div class="my-2 grid justify-items-start gap-2" bind:this={handOverBox}>
			<Alert tone="info">
				Password for <strong>{handOver.user}</strong>:
				<code class="text-md select-all">{handOver.password}</code> – shown only once.
			</Alert>
			<Button onclick={() => (handOver = null)}>Done</Button>
		</div>
	{/if}

	{#each users.data?.users ?? [] as user (user.name)}
		<div class="grid gap-2 border-t py-3">
			<div class="flex flex-wrap items-center gap-2">
				<strong>{user.name}</strong>
				<Badge>{user.role}</Badge>
				{#if user.name === users.data?.me}<span class="text-muted">(you)</span>{/if}
				{#if user.mustChangePassword}<span class="text-muted">· initial password</span>{/if}
				<span class="flex-1"></span>
				<Menu label="Actions for {user.name}" icon items={actions(user)}>
					{#snippet trigger()}<EllipsisVertical size={16} />{/snippet}
				</Menu>
			</div>
		</div>
	{/each}

	{#if error && !creating}<Alert>{error}</Alert>{/if}
</Panel>

<Dialog bind:this={newDialog} width={460} onclose={() => (creating = false)}>
	<form class="grid gap-2 [&_label]:m-0" onsubmit={add}>
		<h2 class="m-0 text-md">New user</h2>
		<div class="flex flex-wrap items-center gap-2 [&>label]:min-w-[160px] [&>label]:flex-1">
			<Input
				label="User name"
				bind:value={newName}
				required
				maxlength={23}
				pattern="[A-Za-z0-9._\-]+"
				autocomplete="off"
				autocapitalize="off"
				title="Gets a one-time password, to be changed at the first login"
			/>
			<Select label="Role" bind:value={newRole}>
				<option value="user">User</option>
				<option value="admin">Admin</option>
			</Select>
		</div>
		{#if error}<Alert>{error}</Alert>{/if}
		<div class="flex flex-wrap items-center gap-2 justify-end">
			<Button onclick={() => newDialog?.close()}>Cancel</Button>
			<Button type="submit" variant="primary" disabled={busy}>Create user</Button>
		</div>
	</form>
</Dialog>
