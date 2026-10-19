// RFC 4180 CSV that opens cleanly in Excel and Google Sheets: UTF-8 BOM, CRLF, quoted when needed.

export const BOM = '\uFEFF';

export type Cell = string | number | boolean | null | undefined;

const NEEDS_QUOTES = /[",\r\n]/;
// Spreadsheet apps run cells starting with these as formulas (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/;

/** `text` marks free text typed by people (names, notes), which gets the formula guard. */
export function csvCell(value: Cell, text = false): string {
	if (value === null || value === undefined) return '';
	let out = typeof value === 'string' ? value : String(value);
	if (text && FORMULA_START.test(out)) out = `'${out}`;
	return NEEDS_QUOTES.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}

export interface CsvColumn<Row> {
	header: string;
	value: (row: Row) => Cell;
	text?: boolean;
}

export function csvHeader<Row>(columns: readonly CsvColumn<Row>[]): string {
	return `${columns.map((c) => csvCell(c.header)).join(',')}\r\n`;
}

export function csvRows<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
	return rows
		.map((row) => `${columns.map((c) => csvCell(c.value(row), c.text)).join(',')}\r\n`)
		.join('');
}
