import type { DemoEnv } from '@/lib/env';
import type { Db } from '@/lib/shop/settings';

/** Signs `client` in as the shared demo user; false if the demo account is missing or broken. */
export async function signInAsDemoUser(admin: Db, client: Db, demo: DemoEnv): Promise<boolean> {
	// Visitors share this login: restoring its email and password first means changing them locks nobody out.
	const { error: restoreError } = await admin.auth.admin.updateUserById(demo.userId, {
		email: demo.email,
		password: demo.password,
		email_confirm: true,
	});
	if (restoreError) return false;

	const { data, error } = await client.auth.signInWithPassword({
		email: demo.email,
		password: demo.password,
	});
	return !error && data.user.id === demo.userId;
}
