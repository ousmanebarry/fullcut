import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportZipStream } from '@/lib/export';
import { BOM, csvCell, csvHeader, csvRows, type CsvColumn } from '@/lib/export/csv';
import type { ExportContext, ExportSource } from '@/lib/export/tables';
import type { Db } from '@/lib/shop/settings';
import { timeZone } from '@/lib/time';

describe('csvCell', () => {
	it.each([
		[null, ''],
		[undefined, ''],
		[true, 'true'],
		[3550, '3550'],
		['plain', 'plain'],
		['Smith, Jo', '"Smith, Jo"'],
		['say "hi"', '"say ""hi"""'],
		['line\nbreak', '"line\nbreak"'],
		['Zoë Ünal 李', 'Zoë Ünal 李'],
		['+14165550123', '+14165550123'],
	])('%j → %j', (value, expected) => {
		expect(csvCell(value)).toBe(expected);
	});

	it.each([
		['=HYPERLINK("x")', `"'=HYPERLINK(""x"")"`],
		['+1+1', "'+1+1"],
		['-2', "'-2"],
		['@SUM(A1)', "'@SUM(A1)"],
		['\tTab', "'\tTab"],
	])('neutralises formula-like free text %j', (value, expected) => {
		expect(csvCell(value, true)).toBe(expected);
	});
});

describe('csv rows', () => {
	const columns: CsvColumn<{ name: string; n: number }>[] = [
		{ header: 'name', value: (r) => r.name, text: true },
		{ header: 'n', value: (r) => r.n },
	];

	it('uses CRLF line endings', () => {
		expect(csvHeader(columns)).toBe('name,n\r\n');
		expect(
			csvRows(columns, [
				{ name: 'A', n: 1 },
				{ name: 'B, C', n: 2 },
			]),
		).toBe('A,1\r\n"B, C",2\r\n');
	});
});

describe('exportZipStream', () => {
	// Keep the BOM so the test can see it.
	const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
	const strFromU8 = (bytes: Uint8Array) => decoder.decode(bytes);
	const ctx: ExportContext = {
		db: {} as Db,
		shopId: 'shop',
		timezone: timeZone('America/Toronto'),
		currency: 'CAD',
		memberNames: new Map(),
	};

	function fakeSource(file: string, pages: string[]): ExportSource {
		return {
			file,
			table: file,
			async *chunks() {
				yield `${BOM}header\r\n`;
				for (const page of pages) yield page;
			},
		};
	}

	async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
		return new Uint8Array(await new Response(stream).arrayBuffer());
	}

	it('streams every source into one ZIP, page by page', async () => {
		const many = Array.from({ length: 50 }, (_, i) => `row ${i}\r\n`);
		const zip = unzipSync(
			await collect(
				exportZipStream(ctx, [
					fakeSource('a.csv', ['one\r\n']),
					fakeSource('empty.csv', []),
					fakeSource('b.csv', many),
				]),
			),
		);
		expect(Object.keys(zip)).toEqual(['a.csv', 'empty.csv', 'b.csv']);
		expect(strFromU8(zip['a.csv'] as Uint8Array)).toBe(`${BOM}header\r\none\r\n`);
		expect(strFromU8(zip['empty.csv'] as Uint8Array)).toBe(`${BOM}header\r\n`);
		expect(strFromU8(zip['b.csv'] as Uint8Array)).toBe(`${BOM}header\r\n${many.join('')}`);
	});

	it('errors the stream when a source fails', async () => {
		const broken: ExportSource = {
			file: 'broken.csv',
			table: 'broken',
			async *chunks() {
				throw new Error('db down');
			},
		};
		await expect(collect(exportZipStream(ctx, [broken]))).rejects.toThrow('db down');
	});
});
