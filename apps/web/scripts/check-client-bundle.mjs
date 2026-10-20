// Fails if a server-only secret made it into the browser bundle (.next/static).
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const staticDir = process.argv[2] ?? fileURLToPath(new URL('../.next/static', import.meta.url));

const PATTERNS = [
	{ name: 'Supabase secret key', regex: /sb_secret_[A-Za-z0-9_-]{8,}/ },
	{ name: 'Stripe secret key', regex: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/ },
	{ name: 'Stripe webhook secret', regex: /\bwhsec_[A-Za-z0-9]{8,}/ },
];

const SECRET_ENV_VARS = [
	'SUPABASE_SECRET_KEY',
	'SUPABASE_DB_URL',
	'STRIPE_SECRET_KEY',
	'STRIPE_WEBHOOK_SECRET',
	'TWILIO_AUTH_TOKEN',
	'JOBS_SECRET',
	'DEMO_PASSWORD',
];

const literals = SECRET_ENV_VARS.flatMap((name) => {
	const value = process.env[name];
	return value && value.length >= 8 ? [{ name, value }] : [];
});

async function* walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(path);
		else if (/\.(?:js|mjs|json|html|css|map|txt)$/.test(entry.name)) yield path;
	}
}

const findings = [];
let scanned = 0;
try {
	for await (const file of walk(staticDir)) {
		scanned++;
		const content = await readFile(file, 'utf8');
		const where = relative(staticDir, file);
		for (const { name, regex } of PATTERNS) {
			if (regex.test(content)) findings.push(`${where}: looks like a ${name}`);
		}
		for (const { name, value } of literals) {
			if (content.includes(value)) findings.push(`${where}: contains the value of ${name}`);
		}
	}
} catch (error) {
	if (error.code === 'ENOENT') {
		console.error(`No build output at ${staticDir}. Run \`pnpm --filter web build\` first.`);
		process.exit(1);
	}
	throw error;
}

if (scanned === 0) {
	console.error(`No files found in ${staticDir}.`);
	process.exit(1);
}

if (findings.length > 0) {
	console.error('Server secrets found in the client bundle:');
	for (const finding of findings) console.error(`  ${finding}`);
	process.exit(1);
}

console.log(
	`Client bundle clean: ${scanned} files, ${PATTERNS.length} patterns, ${literals.length} secret values checked.`,
);
