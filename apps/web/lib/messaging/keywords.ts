export type InboundKind = 'opt_out' | 'opt_in' | 'confirm' | 'other';

// Twilio's default opt-out/opt-in keywords, so our records agree with what Twilio enforces.
const OPT_OUT = new Set([
	'STOP',
	'STOPALL',
	'UNSUBSCRIBE',
	'CANCEL',
	'END',
	'QUIT',
	'OPTOUT',
	'REVOKE',
]);
const OPT_IN = new Set(['START', 'UNSTOP']);
const CONFIRM = new Set(['YES', 'Y']);

/** Classifies a reply by its whole text ("Yes!" confirms; "yes but can I move it?" does not). */
export function parseInboundKind(body: string): InboundKind {
	const word = body
		.trim()
		.toUpperCase()
		.replace(/[\s.!,?]+$/u, '');
	if (OPT_OUT.has(word)) return 'opt_out';
	if (OPT_IN.has(word)) return 'opt_in';
	if (CONFIRM.has(word)) return 'confirm';
	return 'other';
}
