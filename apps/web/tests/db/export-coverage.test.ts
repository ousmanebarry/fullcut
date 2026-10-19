import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXPORT_EXCLUDED, EXPORT_SOURCES } from '@/lib/export/tables';
import { dbUrl } from './local-supabase';

// The shop owns its data: a new tenant table must be exported or explicitly excluded with a reason.

const admin = new pg.Client({ connectionString: dbUrl });

describe('export coverage', () => {
	beforeAll(() => admin.connect());
	afterAll(() => admin.end());

	it('covers every tenant table exactly once', async () => {
		const { rows } = await admin.query<{ table_name: string }>(
			`select c.table_name
			 from information_schema.columns c
			 join information_schema.tables t
			   on t.table_schema = c.table_schema and t.table_name = c.table_name
			 where c.table_schema = 'public' and c.column_name = 'shop_id' and t.table_type = 'BASE TABLE'
			 order by 1`,
		);
		const exported = EXPORT_SOURCES.map((s) => s.table);
		const excluded = Object.keys(EXPORT_EXCLUDED);
		const covered = [...exported, ...excluded].sort();

		expect(new Set(covered).size, 'a table is both exported and excluded, or exported twice').toBe(
			covered.length,
		);
		expect(
			covered,
			'export a new tenant table in lib/export/tables.ts or add it to EXPORT_EXCLUDED',
		).toEqual(rows.map((r) => r.table_name));
	});
});
