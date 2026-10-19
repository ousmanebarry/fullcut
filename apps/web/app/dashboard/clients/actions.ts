'use server';

import { refresh } from 'next/cache';
import { requireShopMember, toActor } from '@/lib/auth/session';
import {
	addClientNote,
	anonymiseClient,
	deleteClientNote,
	mergeClients,
	updateClientContact,
	type ClientError,
} from '@/lib/clients/mutations';
import { clientContactSchema, clientNoteSchema, mergeClientsSchema } from '@/lib/clients/schemas';
import type { ClientActionResult } from '@/lib/clients/types';
import { idSchema } from '@/lib/dashboard/schemas';
import { fieldErrorsFrom } from '@/lib/forms';
import { createClient } from '@/lib/supabase/server';

// The shop always comes from the session, never the request.
async function clientContext() {
	const ctx = await requireShopMember();
	return { actor: toActor(ctx), shop: ctx.shop, db: await createClient() };
}

const INVALID: ClientActionResult = {
	ok: false,
	message: 'Something went wrong. Refresh and try again.',
};

function failed(error: ClientError): ClientActionResult {
	return {
		ok: false,
		message: error.message,
		fieldErrors: error.field ? { [error.field]: error.message } : undefined,
		duplicate: error.duplicate,
	};
}

function done(message: string, redirectTo?: string): ClientActionResult {
	refresh();
	return { ok: true, message, redirectTo };
}

export async function updateClientAction(input: unknown): Promise<ClientActionResult> {
	const parsed = clientContactSchema.safeParse(input);
	if (!parsed.success) {
		return {
			ok: false,
			message: 'Check the highlighted fields.',
			fieldErrors: fieldErrorsFrom(parsed.error),
		};
	}
	const { actor, shop, db } = await clientContext();
	const result = await updateClientContact(db, actor, shop, parsed.data);
	return result.ok ? done('Client saved.') : failed(result.error);
}

export async function mergeClientsAction(input: unknown): Promise<ClientActionResult> {
	const parsed = mergeClientsSchema.safeParse(input);
	if (!parsed.success) return INVALID;
	const { actor, shop, db } = await clientContext();
	const result = await mergeClients(db, actor, shop, parsed.data);
	if (!result.ok) return failed(result.error);
	return done('Clients merged.', `/dashboard/clients/${result.value.clientId}`);
}

export async function deleteClientDataAction(clientId: unknown): Promise<ClientActionResult> {
	const id = idSchema.safeParse(clientId);
	if (!id.success) return INVALID;
	const { actor, db } = await clientContext();
	const result = await anonymiseClient(db, actor, id.data);
	return result.ok ? done('Client data deleted.') : failed(result.error);
}

export async function addNoteAction(input: unknown): Promise<ClientActionResult> {
	const parsed = clientNoteSchema.safeParse(input);
	if (!parsed.success) {
		return {
			ok: false,
			message: parsed.error.issues[0]?.message ?? 'Write a note.',
			fieldErrors: fieldErrorsFrom(parsed.error),
		};
	}
	const { actor, db } = await clientContext();
	const result = await addClientNote(db, actor, parsed.data);
	return result.ok ? done('Note added.') : failed(result.error);
}

export async function deleteNoteAction(noteId: unknown): Promise<ClientActionResult> {
	const id = idSchema.safeParse(noteId);
	if (!id.success) return INVALID;
	const { actor, db } = await clientContext();
	const result = await deleteClientNote(db, actor, id.data);
	return result.ok ? done('Note deleted.') : failed(result.error);
}
