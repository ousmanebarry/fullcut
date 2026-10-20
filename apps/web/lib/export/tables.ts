// What goes into the shop's data export. Every tenant table must appear in EXPORT_SOURCES or
// EXPORT_EXCLUDED; tests/db/export-coverage.test.ts fails otherwise.
import { centsToDollarInput } from '@/lib/money';
import type { Db } from '@/lib/shop/settings';
import { formatSheetDateTime, instantFromIso, type TimeZone } from '@/lib/time';
import { BOM, csvHeader, csvRows, type CsvColumn } from './csv';

export interface ExportContext {
	db: Db;
	shopId: string;
	timezone: TimeZone;
	currency: string;
	/** user id → display name, for note authors. */
	memberNames: ReadonlyMap<string, string>;
}

export interface ExportSource {
	file: string;
	table: string;
	/** CSV text in chunks: BOM and header first, then one chunk per page of rows. */
	chunks(ctx: ExportContext): AsyncGenerator<string>;
}

interface Cursor {
	key: string;
	id: string;
}

interface Format {
	ctx: ExportContext;
	local: (iso: string | null) => string | null;
}

export const EXPORT_PAGE_SIZE = 1000;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dollars = (cents: number) => centsToDollarInput(cents);

/** Rows after `cursor` in (column, id) order; values are quoted for PostgREST's filter syntax. */
function keyset<Q extends { or(filters: string): Q }>(
	query: Q,
	column: string,
	cursor: Cursor | null,
): Q {
	if (!cursor) return query;
	return query.or(
		`${column}.gt."${cursor.key}",and(${column}.eq."${cursor.key}",id.gt.${cursor.id})`,
	);
}

function source<Row>(spec: {
	file: string;
	table: string;
	columns: (format: Format) => readonly CsvColumn<NoInfer<Row>>[];
	fetch: (ctx: ExportContext, cursor: Cursor | null) => Promise<Row[]>;
	cursor: (row: NoInfer<Row>) => Cursor;
}): ExportSource {
	return {
		file: spec.file,
		table: spec.table,
		async *chunks(ctx) {
			const columns = spec.columns({
				ctx,
				local: (iso) => (iso ? formatSheetDateTime(instantFromIso(iso), ctx.timezone) : null),
			});
			yield BOM + csvHeader(columns);
			let cursor: Cursor | null = null;
			for (;;) {
				const rows = await spec.fetch(ctx, cursor);
				if (rows.length > 0) yield csvRows(columns, rows);
				const last = rows.at(-1);
				if (!last || rows.length < EXPORT_PAGE_SIZE) return;
				cursor = spec.cursor(last);
			}
		},
	};
}

function unwrap<T>(result: { data: T[] | null; error: unknown }): T[] {
	if (result.error) throw result.error;
	return result.data ?? [];
}

const byCreated = (row: { created_at: string; id: string }): Cursor => ({
	key: row.created_at,
	id: row.id,
});

const clients = source({
	file: 'clients.csv',
	table: 'clients',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('clients')
					.select(
						'id, name, phone_e164, email, first_source, marketing_opt_in, marketing_opt_in_at, marketing_opt_in_method, sms_opted_out, anonymised_at, created_at',
					)
					.eq('shop_id', ctx.shopId),
				'created_at',
				cursor,
			)
				.order('created_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: byCreated,
	columns: ({ ctx, local }) => [
		{ header: 'client_id', value: (r) => r.id },
		{ header: 'name', value: (r) => r.name, text: true },
		{ header: 'phone', value: (r) => r.phone_e164 },
		{ header: 'email', value: (r) => r.email, text: true },
		{ header: 'first_source', value: (r) => r.first_source, text: true },
		{ header: 'marketing_opt_in', value: (r) => r.marketing_opt_in },
		{ header: 'marketing_opt_in_at', value: (r) => local(r.marketing_opt_in_at) },
		{ header: 'marketing_opt_in_method', value: (r) => r.marketing_opt_in_method, text: true },
		{ header: 'sms_opted_out', value: (r) => r.sms_opted_out },
		{ header: 'deleted_at', value: (r) => local(r.anonymised_at) },
		{ header: 'created_at', value: (r) => local(r.created_at) },
		{ header: 'timezone', value: () => ctx.timezone },
	],
});

const clientNotes = source({
	file: 'client_notes.csv',
	table: 'client_notes',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('client_notes')
					.select(
						'id, client_id, body, author_user_id, created_at, client:clients!client_notes_client_same_shop_fk(name)',
					)
					.eq('shop_id', ctx.shopId),
				'created_at',
				cursor,
			)
				.order('created_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: byCreated,
	columns: ({ ctx, local }) => [
		{ header: 'note_id', value: (r) => r.id },
		{ header: 'client_id', value: (r) => r.client_id },
		{ header: 'client_name', value: (r) => r.client.name, text: true },
		{ header: 'note', value: (r) => r.body, text: true },
		{
			header: 'author',
			value: (r) => (r.author_user_id ? ctx.memberNames.get(r.author_user_id) : null),
			text: true,
		},
		{ header: 'author_user_id', value: (r) => r.author_user_id },
		{ header: 'created_at', value: (r) => local(r.created_at) },
		{ header: 'timezone', value: () => ctx.timezone },
	],
});

const services = source({
	file: 'services.csv',
	table: 'services',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('services')
					.select(
						'id, name, duration_minutes, buffer_minutes, price_cents, deposit_cents, active, sort_order, created_at',
					)
					.eq('shop_id', ctx.shopId),
				'created_at',
				cursor,
			)
				.order('created_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: byCreated,
	columns: ({ ctx, local }) => [
		{ header: 'service_id', value: (r) => r.id },
		{ header: 'name', value: (r) => r.name, text: true },
		{ header: 'duration_minutes', value: (r) => r.duration_minutes },
		{ header: 'buffer_minutes', value: (r) => r.buffer_minutes },
		{ header: 'price', value: (r) => dollars(r.price_cents) },
		{ header: 'deposit', value: (r) => dollars(r.deposit_cents) },
		{ header: 'currency', value: () => ctx.currency },
		{ header: 'active', value: (r) => r.active },
		{ header: 'sort_order', value: (r) => r.sort_order },
		{ header: 'created_at', value: (r) => local(r.created_at) },
		{ header: 'timezone', value: () => ctx.timezone },
	],
});

const staff = source({
	file: 'staff.csv',
	table: 'staff',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('staff')
					.select('id, display_name, active, created_at')
					.eq('shop_id', ctx.shopId),
				'created_at',
				cursor,
			)
				.order('created_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: byCreated,
	columns: ({ ctx, local }) => [
		{ header: 'staff_id', value: (r) => r.id },
		{ header: 'name', value: (r) => r.display_name, text: true },
		{ header: 'active', value: (r) => r.active },
		{ header: 'created_at', value: (r) => local(r.created_at) },
		{ header: 'timezone', value: () => ctx.timezone },
	],
});

const bookings = source({
	file: 'bookings.csv',
	table: 'bookings',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('bookings')
					.select(
						'id, starts_at, ends_at, status, source, price_cents, deposit_cents, client_notes, cancel_reason, cancelled_at, outcome_marked_at, risk_score, risk_model_version, created_at, client_id, service_id, staff_id, client:clients!bookings_client_same_shop_fk(name, phone_e164), service:services!bookings_service_same_shop_fk(name), staff:staff!bookings_staff_same_shop_fk(display_name)',
					)
					.eq('shop_id', ctx.shopId),
				'starts_at',
				cursor,
			)
				.order('starts_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: (r) => ({ key: r.starts_at, id: r.id }),
	columns: ({ ctx, local }) => [
		{ header: 'booking_id', value: (r) => r.id },
		{ header: 'starts_at', value: (r) => local(r.starts_at) },
		{ header: 'ends_at', value: (r) => local(r.ends_at) },
		{ header: 'timezone', value: () => ctx.timezone },
		{ header: 'status', value: (r) => r.status },
		{ header: 'source', value: (r) => r.source, text: true },
		{ header: 'client_id', value: (r) => r.client_id },
		{ header: 'client_name', value: (r) => r.client.name, text: true },
		{ header: 'client_phone', value: (r) => r.client.phone_e164 },
		{ header: 'service_id', value: (r) => r.service_id },
		{ header: 'service_name', value: (r) => r.service.name, text: true },
		{ header: 'staff_id', value: (r) => r.staff_id },
		{ header: 'staff_name', value: (r) => r.staff.display_name, text: true },
		{ header: 'price', value: (r) => dollars(r.price_cents) },
		{ header: 'deposit', value: (r) => dollars(r.deposit_cents) },
		{ header: 'currency', value: () => ctx.currency },
		{ header: 'client_notes', value: (r) => r.client_notes, text: true },
		{ header: 'cancel_reason', value: (r) => r.cancel_reason, text: true },
		{ header: 'cancelled_at', value: (r) => local(r.cancelled_at) },
		{ header: 'outcome_marked_at', value: (r) => local(r.outcome_marked_at) },
		{ header: 'risk_score', value: (r) => r.risk_score },
		{ header: 'risk_model_version', value: (r) => r.risk_model_version },
		{ header: 'created_at', value: (r) => local(r.created_at) },
		{ header: 'starts_at_utc', value: (r) => r.starts_at },
		{ header: 'ends_at_utc', value: (r) => r.ends_at },
	],
});

const availability = source({
	file: 'availability.csv',
	table: 'availability_rules',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('availability_rules')
					.select(
						'id, staff_id, weekday, start_time, end_time, created_at, staff:staff!availability_rules_staff_same_shop_fk(display_name)',
					)
					.eq('shop_id', ctx.shopId),
				'created_at',
				cursor,
			)
				.order('created_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: byCreated,
	columns: ({ ctx }) => [
		{ header: 'rule_id', value: (r) => r.id },
		{ header: 'staff_id', value: (r) => r.staff_id },
		{ header: 'staff_name', value: (r) => r.staff.display_name, text: true },
		{ header: 'weekday', value: (r) => WEEKDAYS[r.weekday] },
		{ header: 'weekday_number', value: (r) => r.weekday },
		{ header: 'start_time', value: (r) => r.start_time.slice(0, 5) },
		{ header: 'end_time', value: (r) => r.end_time.slice(0, 5) },
		{ header: 'timezone', value: () => ctx.timezone },
	],
});

const timeOff = source({
	file: 'time_off.csv',
	table: 'time_off',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('time_off')
					.select(
						'id, staff_id, starts_at, ends_at, reason, created_at, staff:staff!time_off_staff_same_shop_fk(display_name)',
					)
					.eq('shop_id', ctx.shopId),
				'created_at',
				cursor,
			)
				.order('created_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: byCreated,
	columns: ({ ctx, local }) => [
		{ header: 'time_off_id', value: (r) => r.id },
		{ header: 'staff_id', value: (r) => r.staff_id },
		{ header: 'staff_name', value: (r) => r.staff.display_name, text: true },
		{ header: 'starts_at', value: (r) => local(r.starts_at) },
		{ header: 'ends_at', value: (r) => local(r.ends_at) },
		{ header: 'timezone', value: () => ctx.timezone },
		{ header: 'reason', value: (r) => r.reason, text: true },
		{ header: 'starts_at_utc', value: (r) => r.starts_at },
		{ header: 'ends_at_utc', value: (r) => r.ends_at },
	],
});

const activity = source({
	file: 'activity.csv',
	table: 'audit_events',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('audit_events')
					.select('id, action, actor_user_id, actor_email, subject_id, details, created_at')
					.eq('shop_id', ctx.shopId),
				'created_at',
				cursor,
			)
				.order('created_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: byCreated,
	columns: ({ ctx, local }) => [
		{ header: 'event_id', value: (r) => r.id },
		{ header: 'occurred_at', value: (r) => local(r.created_at) },
		{ header: 'timezone', value: () => ctx.timezone },
		{ header: 'action', value: (r) => r.action },
		{ header: 'actor_user_id', value: (r) => r.actor_user_id },
		{ header: 'actor_email', value: (r) => r.actor_email, text: true },
		{ header: 'subject_id', value: (r) => r.subject_id },
		{ header: 'details', value: (r) => JSON.stringify(r.details) },
	],
});

const textMessages = source({
	file: 'text_messages.csv',
	table: 'scheduled_messages',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('scheduled_messages')
					.select(
						'id, booking_id, client_id, type, status, skip_reason, send_at, sent_at, delivery_status, delivered_at, error_code, body, created_at',
					)
					.eq('shop_id', ctx.shopId),
				'created_at',
				cursor,
			)
				.order('created_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: byCreated,
	columns: ({ ctx, local }) => [
		{ header: 'message_id', value: (r) => r.id },
		{ header: 'booking_id', value: (r) => r.booking_id },
		{ header: 'client_id', value: (r) => r.client_id },
		{ header: 'type', value: (r) => r.type },
		{ header: 'status', value: (r) => r.status },
		{ header: 'skip_reason', value: (r) => r.skip_reason },
		{ header: 'send_at', value: (r) => local(r.send_at) },
		{ header: 'sent_at', value: (r) => local(r.sent_at) },
		{ header: 'delivery_status', value: (r) => r.delivery_status },
		{ header: 'delivered_at', value: (r) => local(r.delivered_at) },
		{ header: 'error_code', value: (r) => r.error_code },
		{ header: 'text', value: (r) => r.body, text: true },
		{ header: 'created_at', value: (r) => local(r.created_at) },
		{ header: 'timezone', value: () => ctx.timezone },
	],
});

const textReplies = source({
	file: 'text_replies.csv',
	table: 'inbound_messages',
	fetch: async (ctx: ExportContext, cursor: Cursor | null) =>
		unwrap(
			await keyset(
				ctx.db
					.from('inbound_messages')
					.select(
						'id, client_id, booking_id, from_phone, body, kind, handled_at, handled_by, created_at',
					)
					.eq('shop_id', ctx.shopId),
				'created_at',
				cursor,
			)
				.order('created_at')
				.order('id')
				.limit(EXPORT_PAGE_SIZE),
		),
	cursor: byCreated,
	columns: ({ ctx, local }) => [
		{ header: 'reply_id', value: (r) => r.id },
		{ header: 'received_at', value: (r) => local(r.created_at) },
		{ header: 'timezone', value: () => ctx.timezone },
		{ header: 'client_id', value: (r) => r.client_id },
		{ header: 'booking_id', value: (r) => r.booking_id },
		{ header: 'from_phone', value: (r) => r.from_phone },
		{ header: 'text', value: (r) => r.body, text: true },
		{ header: 'kind', value: (r) => r.kind },
		{ header: 'handled_at', value: (r) => local(r.handled_at) },
		{
			header: 'handled_by',
			value: (r) => (r.handled_by ? ctx.memberNames.get(r.handled_by) : null),
			text: true,
		},
	],
});

export const EXPORT_SOURCES: readonly ExportSource[] = [
	clients,
	clientNotes,
	services,
	staff,
	bookings,
	availability,
	timeOff,
	activity,
	textMessages,
	textReplies,
];

/** Tenant tables deliberately left out of the export, with the reason. */
export const EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
	booking_links: 'Hashes of secret manage-link tokens; useless outside Fullcut.',
	shop_members: 'Login accounts, which belong to people rather than the shop.',
};
