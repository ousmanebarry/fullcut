// Owner-only full data export: a ZIP of CSVs streamed page by page, so memory stays flat.
import { Zip, ZipDeflate } from 'fflate';
import { isOwner } from '@/lib/auth/roles';
import type { Result } from '@/lib/booking/types';
import { toUserFacingError, type UserFacingError } from '@/lib/db/errors';
import type { Actor, Db } from '@/lib/shop/settings';
import { localDateOf, type Instant, type TimeZone } from '@/lib/time';
import { EXPORT_SOURCES, type ExportContext, type ExportSource } from './tables';

export const EXPORT_OWNER_ONLY: UserFacingError = {
	message: 'Only the shop owner can export shop data.',
};

export interface ExportShop {
	id: string;
	slug: string;
	timezone: TimeZone;
	currency: string;
}

export function exportFileName(shop: ExportShop, now: Instant): string {
	return `fullcut-export-${shop.slug}-${localDateOf(now, shop.timezone)}.zip`;
}

/** Streams every source into one ZIP; each pull writes at most one page of rows. */
export function exportZipStream(
	ctx: ExportContext,
	sources: readonly ExportSource[] = EXPORT_SOURCES,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let zip: Zip;
	let emitted = false;

	async function* steps(): AsyncGenerator<void> {
		for (const source of sources) {
			const entry = new ZipDeflate(source.file, { level: 6 });
			zip.add(entry);
			for await (const chunk of source.chunks(ctx)) {
				entry.push(encoder.encode(chunk));
				yield;
			}
			entry.push(new Uint8Array(0), true);
		}
		zip.end();
	}
	const run = steps();

	return new ReadableStream<Uint8Array>({
		start(controller) {
			zip = new Zip((error, data, final) => {
				if (error) {
					controller.error(error);
					return;
				}
				emitted = true;
				controller.enqueue(data);
				if (final) controller.close();
			});
		},
		async pull(controller) {
			// The stream only pulls again after something is enqueued, so keep going until then.
			emitted = false;
			try {
				while (!emitted) {
					if ((await run.next()).done) return;
				}
			} catch (error) {
				controller.error(error);
			}
		},
		async cancel() {
			await run.return(undefined);
		},
	});
}

async function memberNames(db: Db, shopId: string): Promise<Map<string, string>> {
	const { data, error } = await db
		.from('shop_members')
		.select('user_id, role, staff:staff!shop_members_staff_same_shop_fk(display_name)')
		.eq('shop_id', shopId);
	if (error) throw error;
	return new Map(
		data.map((m) => [m.user_id, m.staff?.display_name ?? (m.role === 'owner' ? 'Owner' : 'Staff')]),
	);
}

/** Checks the owner, logs the export, then returns the ZIP stream. */
export async function startExport(
	db: Db,
	actor: Actor,
	shop: ExportShop,
): Promise<Result<ReadableStream<Uint8Array>, UserFacingError>> {
	if (!isOwner(actor) || actor.shopId !== shop.id) return { ok: false, error: EXPORT_OWNER_ONLY };

	const { error } = await db.from('audit_events').insert({ shop_id: shop.id, action: 'export' });
	if (error) return { ok: false, error: toUserFacingError(error) };

	const ctx: ExportContext = {
		db,
		shopId: shop.id,
		timezone: shop.timezone,
		currency: shop.currency,
		memberNames: await memberNames(db, shop.id),
	};
	return { ok: true, value: exportZipStream(ctx) };
}
