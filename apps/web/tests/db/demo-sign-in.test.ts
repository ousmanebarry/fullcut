import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@/lib/database.types';
import { signInAsDemoUser } from '@/lib/demo/sign-in';
import type { DemoEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { dbUrl, localSupabaseApi, useLocalSupabaseEnv } from './local-supabase';

const demo: DemoEnv = {
	userId: randomUUID(),
	email: `demo-${randomUUID()}@test.example.com`,
	password: 'demo-test-password-123',
	shopSlug: 'unused-in-this-test',
};

const db = new pg.Client({ connectionString: dbUrl });

function anonClient() {
	const { url, publishableKey } = localSupabaseApi();
	return createClient<Database>(url, publishableKey, {
		auth: { persistSession: false, autoRefreshToken: false },
	});
}

describe('signInAsDemoUser', () => {
	beforeAll(async () => {
		useLocalSupabaseEnv();
		await db.connect();
		await db.query(
			`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
			   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
			   confirmation_token, recovery_token, email_change_token_new, email_change)
			 values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
			   extensions.crypt($3, extensions.gen_salt('bf')), now(),
			   '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', '')`,
			[demo.userId, demo.email, demo.password],
		);
		await db.query(
			`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
			 values ($1::text, $1::uuid, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now())`,
			[demo.userId, demo.email],
		);
	});

	afterAll(async () => {
		await db.query('delete from auth.users where id = $1', [demo.userId]);
		await db.end();
	});

	it('signs in even after a visitor changed the shared password and email', async () => {
		const admin = createAdminClient();
		const { error } = await admin.auth.admin.updateUserById(demo.userId, {
			email: `hijacked-${randomUUID()}@test.example.com`,
			password: 'a-visitor-changed-this',
			email_confirm: true,
		});
		expect(error).toBeNull();

		const client = anonClient();
		expect(await signInAsDemoUser(admin, client, demo)).toBe(true);
		const { data } = await client.auth.getUser();
		expect(data.user?.id).toBe(demo.userId);
		expect(data.user?.email).toBe(demo.email);
	});

	it('fails cleanly when the demo user does not exist', async () => {
		const client = anonClient();
		expect(
			await signInAsDemoUser(createAdminClient(), client, { ...demo, userId: randomUUID() }),
		).toBe(false);
		const { data } = await client.auth.getSession();
		expect(data.session).toBeNull();
	});
});
