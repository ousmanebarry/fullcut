// Client-book writes. Callers pass a user-scoped client (RLS applies) and an actor derived on the
// server; every write is also filtered by the actor's shop_id.
import { isOwner } from '@/lib/auth/roles';
import type { Result } from '@/lib/booking/types';
import { countryForCurrency, normalizePhone } from '@/lib/contact/phone';
import { toUserFacingError, type UserFacingError } from '@/lib/db/errors';
import { NOT_FOUND, type Actor, type Db } from '@/lib/shop/settings';
import { findClientByPhone } from './queries';
import type { ClientContactInput, ClientNoteInput, MergeClientsInput } from './schemas';
import type { DuplicateClient } from './types';

export interface ClientError extends UserFacingError {
	duplicate?: DuplicateClient;
}
export type ClientResult<T = null> = Result<T, ClientError>;

export const CLIENT_OWNER_ONLY: ClientError = {
	message: 'Only the shop owner can do this.',
};
const INVALID_PHONE: ClientError = { field: 'phone', message: 'Enter a valid phone number.' };

const ok = <T>(value: T): ClientResult<T> => ({ ok: true, value });
const fail = <T = null>(error: ClientError): ClientResult<T> => ({ ok: false, error });

type CurrencyShop = { currency: string };

function phoneFor(shop: CurrencyShop, phone: string): string | null | undefined {
	if (!phone) return null;
	return normalizePhone(phone, countryForCurrency(shop.currency)) ?? undefined;
}

/** Saves contact details; a number another client already has comes back as `duplicate`. */
export async function updateClientContact(
	db: Db,
	actor: Actor,
	shop: CurrencyShop,
	input: ClientContactInput,
): Promise<ClientResult> {
	const phoneE164 = phoneFor(shop, input.phone);
	if (phoneE164 === undefined) return fail(INVALID_PHONE);

	const { data, error } = await db
		.from('clients')
		.update({ name: input.name, phone_e164: phoneE164, email: input.email ?? null })
		.eq('shop_id', actor.shopId)
		.eq('id', input.clientId)
		.is('anonymised_at', null)
		.select('id');

	if (error?.code === '23505' && phoneE164) {
		const duplicate = await findClientByPhone(db, actor.shopId, phoneE164);
		return fail({
			field: 'phone',
			message: isOwner(actor)
				? `${duplicate?.name ?? 'Another client'} already has this number. Merge them?`
				: `${duplicate?.name ?? 'Another client'} already has this number. Ask the owner to merge them.`,
			duplicate: duplicate ?? undefined,
		});
	}
	if (error) return fail(toUserFacingError(error));
	return data.length > 0 ? ok(null) : fail(NOT_FOUND);
}

/** Owner-only: folds `mergeId` into `keepId` and saves the contact details being edited. */
export async function mergeClients(
	db: Db,
	actor: Actor,
	shop: CurrencyShop,
	input: MergeClientsInput,
): Promise<ClientResult<{ clientId: string }>> {
	if (!isOwner(actor)) return fail(CLIENT_OWNER_ONLY);
	const phoneE164 = phoneFor(shop, input.phone);
	if (phoneE164 === undefined) return fail(INVALID_PHONE);

	const { data, error } = await db.rpc('merge_clients', {
		p_keep_id: input.keepId,
		p_merge_id: input.mergeId,
		p_contact: { name: input.name, phone_e164: phoneE164, email: input.email ?? null },
	});
	if (error) return fail(toUserFacingError(error));
	return ok({ clientId: data });
}

/** Owner-only: removes contact details and notes, keeps anonymised bookings. */
export async function anonymiseClient(
	db: Db,
	actor: Actor,
	clientId: string,
): Promise<ClientResult> {
	if (!isOwner(actor)) return fail(CLIENT_OWNER_ONLY);
	const { error } = await db.rpc('anonymise_client', { p_client_id: clientId });
	return error ? fail(toUserFacingError(error)) : ok(null);
}

export async function addClientNote(
	db: Db,
	actor: Actor,
	input: ClientNoteInput,
): Promise<ClientResult> {
	const { data: client, error: lookupError } = await db
		.from('clients')
		.select('id')
		.eq('shop_id', actor.shopId)
		.eq('id', input.clientId)
		.is('anonymised_at', null)
		.maybeSingle();
	if (lookupError) return fail(toUserFacingError(lookupError));
	if (!client) return fail(NOT_FOUND);

	const { error } = await db
		.from('client_notes')
		.insert({ shop_id: actor.shopId, client_id: input.clientId, body: input.body });
	return error ? fail(toUserFacingError(error)) : ok(null);
}

/** Authors can delete their own notes; owners can delete any. */
export async function deleteClientNote(
	db: Db,
	actor: Actor,
	noteId: string,
): Promise<ClientResult> {
	const { data, error } = await db
		.from('client_notes')
		.delete()
		.eq('shop_id', actor.shopId)
		.eq('id', noteId)
		.select('id');
	if (error) return fail(toUserFacingError(error));
	return data.length > 0
		? ok(null)
		: fail({ message: 'That note is gone, or only its author and the owner can delete it.' });
}
