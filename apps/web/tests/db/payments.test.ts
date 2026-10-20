import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import pg from 'pg';
import Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as cancelRoute } from '@/app/api/manage/cancel/route';
import { POST as bookingsRoute } from '@/app/api/public/[slug]/bookings/route';
import { POST as webhookRoute } from '@/app/api/webhooks/stripe/route';
import { handleStripeEvent, parseStripeEvent } from '@/lib/payments/events';
import type { CheckoutInput, PaymentGateway } from '@/lib/payments/gateway';
import { runPaymentJobs } from '@/lib/payments/jobs';
import { hashToken } from '@/lib/public-booking/links';
import type { BookingCreated, PublicApiError } from '@/lib/public-booking/types';
import type { Db } from '@/lib/shop/settings';
import { createAdminClient } from '@/lib/supabase/admin';
import { instantToIso, type Instant } from '@/lib/time';
import { dbUrl, useLocalSupabaseEnv } from './local-supabase';

// Deposit flow end to end against the local stack, with a fake Stripe gateway (never the network).

const fake = vi.hoisted(() => ({ gateway: null as PaymentGateway | null }));
vi.mock('@/lib/payments/gateway', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/payments/gateway')>();
	return {
		...actual,
		getPaymentGateway: () => fake.gateway,
		paymentsAvailable: () => fake.gateway !== null,
	};
});

const WEBHOOK_SECRET = 'whsec_test_payments_suite_0123456789';
const HOUR = 3_600_000;
const id = { shop: randomUUID(), staff: randomUUID(), service: randomUUID() };
const account = `acct_test${randomBytes(6).toString('hex')}`;
const slug = `pay-${id.shop.slice(0, 8)}`;
const admin = new pg.Client({ connectionString: dbUrl });
let db: Db;

function fakeGateway() {
	const checkouts: CheckoutInput[] = [];
	const refunds: { paymentIntentId: string; amountCents: number; idempotencyKey: string }[] = [];
	const expired: string[] = [];
	const refunded = new Map<string, number>();
	const state = { failCheckout: false };
	const gateway: PaymentGateway = {
		async createCheckout(input) {
			if (state.failCheckout) throw new Error('Stripe is down');
			checkouts.push(input);
			const sessionId = `cs_test_${randomBytes(8).toString('hex')}`;
			return { sessionId, url: `https://checkout.stripe.com/c/pay/${sessionId}` };
		},
		async openCheckoutUrl(_account, sessionId) {
			return `https://checkout.stripe.com/c/pay/${sessionId}`;
		},
		async expireCheckout(_account, sessionId) {
			expired.push(sessionId);
		},
		async refund(input) {
			refunds.push(input);
			const total = (refunded.get(input.paymentIntentId) ?? 0) + input.amountCents;
			refunded.set(input.paymentIntentId, total);
			return total;
		},
		async refundedCents(_account, paymentIntentId) {
			return refunded.get(paymentIntentId) ?? 0;
		},
		async createAccount() {
			return account;
		},
		async onboardingUrl() {
			return 'https://connect.stripe.com/setup/test';
		},
		async accountStatus() {
			return { chargesEnabled: false, detailsSubmitted: true };
		},
	};
	return { gateway, checkouts, refunds, expired, state };
}

let stripe: ReturnType<typeof fakeGateway>;

let phoneCounter = 0;
const nextPhone = () => `(416) 555-02${String(phoneCounter++).padStart(2, '0')}`;

/** A 15-minute-aligned start `hours` from now (the shop is open around the clock). */
function startIn(hours: number): string {
	const quarter = 15 * 60_000;
	return instantToIso((Math.ceil((Date.now() + hours * HOUR) / quarter) * quarter) as Instant);
}

function book(body: Record<string, unknown>) {
	const request = new NextRequest(`http://localhost/api/public/${slug}/bookings`, {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	});
	return bookingsRoute(request, { params: Promise.resolve({ slug }) });
}

const bookingBody = (startsAt: string, overrides: Record<string, unknown> = {}) => ({
	serviceId: id.service,
	staffId: id.staff,
	startsAt,
	name: 'Dee Posit',
	phone: nextPhone(),
	expectedDepositCents: 1500,
	...overrides,
});

interface Held {
	token: string;
	bookingId: string;
	sessionId: string;
	created: BookingCreated;
}

async function hold(startsAt: string): Promise<Held> {
	const res = await book(bookingBody(startsAt));
	expect(res.status).toBe(201);
	const created = (await res.json()) as BookingCreated;
	const token = created.manageUrl.split('/b/')[1] ?? '';
	const { rows } = await admin.query<{ booking_id: string; stripe_checkout_session_id: string }>(
		`select p.booking_id, p.stripe_checkout_session_id from public.booking_links l
		 join public.payments p on p.booking_id = l.booking_id where l.token_hash = $1`,
		[hashToken(token)],
	);
	const row = rows[0];
	if (!row) throw new Error('no payment row');
	return { token, bookingId: row.booking_id, sessionId: row.stripe_checkout_session_id, created };
}

async function state(bookingId: string) {
	const { rows } = await admin.query<{
		booking: string;
		cancelled_by: string | null;
		payment: string;
		refund_due_cents: number;
		refunded_cents: number;
		confirmations: number;
	}>(
		`select b.status as booking, b.cancelled_by, p.status as payment, p.refund_due_cents, p.refunded_cents,
		   (select count(*)::int from public.scheduled_messages m where m.booking_id = b.id and m.type = 'confirmation') as confirmations
		 from public.bookings b join public.payments p on p.booking_id = b.id where b.id = $1`,
		[bookingId],
	);
	return rows[0];
}

let eventCounter = 0;
function event(type: string, object: Record<string, unknown>, eventId?: string) {
	return JSON.stringify({
		id: eventId ?? `evt_test_${eventCounter++}_${randomBytes(4).toString('hex')}`,
		object: 'event',
		type,
		account,
		data: { object },
	});
}

const sessionObject = (held: Held, paymentIntent = `pi_${randomBytes(6).toString('hex')}`) => ({
	id: held.sessionId,
	object: 'checkout.session',
	payment_status: 'paid',
	payment_intent: paymentIntent,
	metadata: { booking_id: held.bookingId, shop_id: id.shop },
});

function webhook(payload: string, signature?: string | null) {
	const header =
		signature === undefined
			? Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET })
			: signature;
	return webhookRoute(
		new Request('http://localhost/api/webhooks/stripe', {
			method: 'POST',
			body: payload,
			headers: header === null ? {} : { 'stripe-signature': header },
		}),
	);
}

const cancel = (token: string) =>
	cancelRoute(
		new NextRequest('http://localhost/api/manage/cancel', {
			method: 'POST',
			body: JSON.stringify({ token }),
			headers: { 'content-type': 'application/json' },
		}),
	);

async function paid(startsAt: string): Promise<Held & { paymentIntent: string }> {
	const held = await hold(startsAt);
	const paymentIntent = `pi_${randomBytes(6).toString('hex')}`;
	expect(
		(await webhook(event('checkout.session.completed', sessionObject(held, paymentIntent)))).status,
	).toBe(200);
	return { ...held, paymentIntent };
}

describe('deposits', () => {
	beforeAll(async () => {
		useLocalSupabaseEnv();
		process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
		db = createAdminClient();
		await admin.connect();
		await admin.query(
			`insert into public.shops (id, name, slug, timezone, min_lead_minutes, stripe_account_id, stripe_charges_enabled,
			   deposit_mode, deposit_default_type, deposit_default_cents, free_cancel_hours, late_cancel_keeps_deposit)
			 values ($1, 'Deposit Test', $2, 'America/Toronto', 0, $3, true, 'all_bookings', 'fixed', 1500, 24, true)`,
			[id.shop, slug, account],
		);
		await admin.query(
			`insert into public.staff (id, shop_id, display_name) values ($1, $2, 'Dana')`,
			[id.staff, id.shop],
		);
		// 15 minutes, so a quarter-hour start never runs past midnight out of that day's hours.
		await admin.query(
			`insert into public.services (id, shop_id, name, duration_minutes, buffer_minutes, price_cents)
			 values ($1, $2, 'Colour', 15, 0, 4000)`,
			[id.service, id.shop],
		);
		await admin.query(
			`insert into public.availability_rules (shop_id, staff_id, weekday, start_time, end_time)
			 select $1::uuid, $2::uuid, d, '00:00'::time, '24:00'::time from generate_series(0, 6) d`,
			[id.shop, id.staff],
		);
	});

	beforeEach(() => {
		stripe = fakeGateway();
		fake.gateway = stripe.gateway;
	});

	afterAll(async () => {
		// Payments block booking deletes on purpose, so remove them before the shop cascade.
		await admin.query('delete from public.payments where shop_id = $1', [id.shop]);
		await admin.query('delete from public.shops where id = $1', [id.shop]);
		await admin.end();
		delete process.env.STRIPE_WEBHOOK_SECRET;
	});

	describe('booking with a deposit', () => {
		it('refuses to charge a deposit the client was not shown', async () => {
			const res = await book(bookingBody(startIn(48), { expectedDepositCents: 0 }));
			expect(res.status).toBe(409);
			expect(await res.json()).toMatchObject({ error: 'deposit_changed', depositCents: 1500 });
			expect(stripe.checkouts).toHaveLength(0);
		});

		it('holds the slot and opens Checkout on the shop account with no Fullcut fee', async () => {
			const before = Date.now();
			const held = await hold(startIn(49));
			expect(held.created.checkoutUrl).toBe(`https://checkout.stripe.com/c/pay/${held.sessionId}`);
			expect(held.created.booking.depositCents).toBe(1500);
			expect(await state(held.bookingId)).toMatchObject({
				booking: 'pending',
				payment: 'pending',
				confirmations: 0,
			});

			const [checkout] = stripe.checkouts;
			expect(checkout).toMatchObject({
				shopId: id.shop,
				bookingId: held.bookingId,
				amountCents: 1500,
				platformFeeCents: 0,
				currency: 'CAD',
				successUrl: `${held.created.manageUrl}?checkout=success`,
				cancelUrl: `${held.created.manageUrl}?checkout=cancelled`,
			});
			const holdMs = (checkout?.expiresAt ?? 0) - before;
			expect(holdMs).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
			expect(holdMs).toBeLessThan(31 * 60_000);
		});

		it('releases the hold when Stripe cannot be reached', async () => {
			stripe.state.failCheckout = true;
			const startsAt = startIn(50);
			const res = await book(bookingBody(startsAt));
			expect(res.status).toBe(503);
			expect(((await res.json()) as PublicApiError).error).toBe('payment_unavailable');

			stripe.state.failCheckout = false;
			expect((await book(bookingBody(startsAt))).status).toBe(201);
		});
	});

	describe('Stripe webhook', () => {
		it('rejects missing and invalid signatures', async () => {
			const held = await hold(startIn(51));
			const payload = event('checkout.session.completed', sessionObject(held));
			expect((await webhook(payload, null)).status).toBe(400);
			const forged = Stripe.webhooks.generateTestHeaderString({
				payload,
				secret: 'whsec_someone_else',
			});
			expect((await webhook(payload, forged)).status).toBe(400);
			const signed = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
			const tampered = payload.replace(held.bookingId, randomUUID());
			expect((await webhook(tampered, signed)).status).toBe(400);
			expect((await state(held.bookingId))?.booking).toBe('pending');
		});

		it('confirms a paid hold once, however often the event arrives', async () => {
			const held = await hold(startIn(52));
			const payload = event('checkout.session.completed', sessionObject(held));
			expect((await webhook(payload)).status).toBe(200);
			expect(await state(held.bookingId)).toMatchObject({
				booking: 'confirmed',
				payment: 'succeeded',
				confirmations: 1,
			});

			expect((await webhook(payload)).status).toBe(200);
			// Same session, new event id: the payment is already recorded.
			expect((await webhook(event('checkout.session.completed', sessionObject(held)))).status).toBe(
				200,
			);
			expect(await state(held.bookingId)).toMatchObject({
				booking: 'confirmed',
				payment: 'succeeded',
				confirmations: 1,
			});
		});

		it('ignores an expiry that arrives after the payment', async () => {
			const held = await paid(startIn(53));
			expect((await webhook(event('checkout.session.expired', sessionObject(held)))).status).toBe(
				200,
			);
			expect(await state(held.bookingId)).toMatchObject({
				booking: 'confirmed',
				payment: 'succeeded',
			});
		});

		it('frees the slot when checkout expires', async () => {
			const startsAt = startIn(54);
			const held = await hold(startsAt);
			expect((await book(bookingBody(startsAt))).status).toBe(409);

			expect((await webhook(event('checkout.session.expired', sessionObject(held)))).status).toBe(
				200,
			);
			expect(await state(held.bookingId)).toMatchObject({
				booking: 'cancelled',
				cancelled_by: 'system',
				payment: 'expired',
			});
			expect((await book(bookingBody(startsAt))).status).toBe(201);
		});

		it('ignores sessions that are not Fullcut deposits', async () => {
			const payload = event('checkout.session.completed', {
				id: 'cs_test_other',
				payment_status: 'paid',
				payment_intent: 'pi_other',
				metadata: {},
			});
			expect((await webhook(payload)).status).toBe(200);
		});

		it('keeps refunds made in the Stripe Dashboard in sync', async () => {
			const held = await paid(startIn(55));
			const payload = event('charge.refunded', {
				id: 'ch_test',
				payment_intent: held.paymentIntent,
				amount_refunded: 500,
			});
			expect((await webhook(payload)).status).toBe(200);
			expect(await state(held.bookingId)).toMatchObject({
				refunded_cents: 500,
				refund_due_cents: 500,
			});
		});
	});

	describe('hold expiry', () => {
		it('the job releases lapsed holds', async () => {
			const held = await hold(startIn(56));
			await admin.query(
				`update public.bookings set pending_expires_at = now() - interval '1 second' where id = $1`,
				[held.bookingId],
			);
			const run = await runPaymentJobs(db, stripe.gateway, Date.now() as Instant);
			expect(run.holdsReleased).toBeGreaterThanOrEqual(1);
			expect(await state(held.bookingId)).toMatchObject({
				booking: 'cancelled',
				cancelled_by: 'system',
				payment: 'pending',
			});
		});

		it('refunds a payment that lands after the slot was given away', async () => {
			const startsAt = startIn(57);
			const held = await hold(startsAt);
			await admin.query(
				`update public.bookings set pending_expires_at = now() - interval '1 second' where id = $1`,
				[held.bookingId],
			);
			expect((await book(bookingBody(startsAt))).status).toBe(201);

			const paymentIntent = 'pi_late_payment';
			expect(
				(await webhook(event('checkout.session.completed', sessionObject(held, paymentIntent))))
					.status,
			).toBe(200);
			expect(await state(held.bookingId)).toMatchObject({
				booking: 'cancelled',
				payment: 'succeeded',
				refund_due_cents: 1500,
				refunded_cents: 1500,
			});
			expect(stripe.refunds).toEqual([
				expect.objectContaining({ paymentIntentId: paymentIntent, amountCents: 1500 }),
			]);
		});
	});

	describe('cancellation refunds', () => {
		it('refunds in full when the client cancels before the free window closes', async () => {
			const held = await paid(startIn(72));
			expect((await cancel(held.token)).status).toBe(200);
			expect(await state(held.bookingId)).toMatchObject({
				booking: 'cancelled',
				refund_due_cents: 1500,
				refunded_cents: 1500,
			});
			expect(stripe.refunds).toHaveLength(1);
		});

		it('keeps the deposit for a late client cancellation', async () => {
			const held = await paid(startIn(5));
			expect((await cancel(held.token)).status).toBe(200);
			expect(await state(held.bookingId)).toMatchObject({
				booking: 'cancelled',
				refund_due_cents: 0,
				refunded_cents: 0,
			});
			expect(stripe.refunds).toHaveLength(0);
		});

		it('closes the Stripe session when the client cancels an unpaid hold', async () => {
			const held = await hold(startIn(73));
			expect((await cancel(held.token)).status).toBe(200);
			expect(stripe.expired).toEqual([held.sessionId]);
			expect(stripe.refunds).toHaveLength(0);
		});

		it('the job retries a refund Stripe refused', async () => {
			const held = await paid(startIn(74));
			const refund = stripe.gateway.refund;
			stripe.gateway.refund = async () => {
				throw new Error('Stripe is down');
			};
			await admin.query(
				`update public.bookings set status = 'cancelled', cancelled_by = 'shop' where id = $1`,
				[held.bookingId],
			);
			await runPaymentJobs(db, stripe.gateway, Date.now() as Instant);
			const { rows } = await admin.query<{ refund_error: string | null }>(
				'select refund_error from public.payments where booking_id = $1',
				[held.bookingId],
			);
			expect(rows[0]?.refund_error).toBe('Stripe is down');

			stripe.gateway.refund = refund;
			await runPaymentJobs(db, stripe.gateway, Date.now() as Instant);
			expect(await state(held.bookingId)).toMatchObject({
				refund_due_cents: 1500,
				refunded_cents: 1500,
			});
		});
	});

	describe('account status', () => {
		it('copies Stripe readiness onto the shop from account events', async () => {
			const parsed = parseStripeEvent(event('account.updated', { id: account }));
			expect(parsed).not.toBeNull();
			if (!parsed) return;
			expect(await handleStripeEvent(db, stripe.gateway, parsed)).toBe(id.shop);
			const { rows } = await admin.query<{ stripe_charges_enabled: boolean }>(
				'select stripe_charges_enabled from public.shops where id = $1',
				[id.shop],
			);
			expect(rows[0]?.stripe_charges_enabled).toBe(false);
			await admin.query('update public.shops set stripe_charges_enabled = true where id = $1', [
				id.shop,
			]);
		});
	});
});
