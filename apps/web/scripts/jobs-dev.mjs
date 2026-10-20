// Ticks the local job endpoint while `pnpm dev` runs; pg_cron does nothing locally (no Vault secrets).
// Usage: pnpm jobs:dev   (reads JOBS_SECRET from apps/web/.env.local)
try {
	process.loadEnvFile('.env.local');
} catch {
	// Fall back to the shell environment.
}

const secret = process.env.JOBS_SECRET;
const url = process.env.JOBS_TICK_URL ?? 'http://localhost:3000/api/jobs/tick';
const intervalMs = 15_000;

if (!secret || secret.length < 32) {
	console.error('Set JOBS_SECRET (32+ characters) in apps/web/.env.local first.');
	process.exit(1);
}

async function tick() {
	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: { Authorization: `Bearer ${secret}` },
		});
		const body = await response.text();
		console.log(`[jobs] ${new Date().toLocaleTimeString()} ${response.status} ${body}`);
	} catch (error) {
		console.log(`[jobs] ${url} not reachable (${error.cause?.code ?? error.message})`);
	}
}

console.log(`[jobs] ticking ${url} every ${intervalMs / 1000}s (Ctrl+C to stop)`);
await tick();
setInterval(tick, intervalMs);
