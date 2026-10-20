// SMS segment counting: GSM-7 fits 160 characters in one segment (153 per part when split);
// a single character outside it switches the whole text to UCS-2 (70, or 67 per part).

const GSM7_BASIC =
	'@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
	'¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

const basic = new Set(GSM7_BASIC);
const extended = new Set(GSM7_EXTENDED);

export interface SegmentInfo {
	encoding: 'GSM-7' | 'UCS-2';
	segments: number;
}

export function smsSegments(text: string): SegmentInfo {
	let septets = 0;
	let gsm = true;
	for (const char of text) {
		if (basic.has(char)) septets += 1;
		else if (extended.has(char)) septets += 2;
		else {
			gsm = false;
			break;
		}
	}
	if (gsm) {
		return { encoding: 'GSM-7', segments: septets <= 160 ? 1 : Math.ceil(septets / 153) };
	}
	const units = text.length;
	return { encoding: 'UCS-2', segments: units <= 70 ? 1 : Math.ceil(units / 67) };
}
