// Every outgoing text, in one place. Plain ASCII where possible (a single curly quote or emoji
// switches the whole text to UCS-2 and halves the characters per segment).
import { formatLocalTime, formatMessageDateTime, type Instant, type TimeZone } from '@/lib/time';
import type { MessageType } from './types';

/** Stands in for the manage link in stored copies; the real token is never stored. */
export const MANAGE_LINK_PLACEHOLDER = '[manage link]';

/** Same idea for the waitlist view/leave link. */
export const WAITLIST_LINK_PLACEHOLDER = '[waitlist link]';

/** And for an offer's claim link. */
export const CLAIM_LINK_PLACEHOLDER = '[claim link]';

export interface TemplateInput {
	shopName: string;
	serviceName: string;
	staffName: string;
	startsAt: Instant;
	timezone: TimeZone;
	manageUrl: string | null;
	signOff: string | null;
	/** The confirmation deadline named in a final warning. */
	confirmationDueAt: Instant | null;
}

/** Whether a message type carries a manage link (a fresh one is issued per send). */
export function needsManageLink(type: MessageType): boolean {
	// The final warning needs the room for its deadline; the request before it carried a link.
	return type !== 'cancelled' && type !== 'released' && type !== 'final_warning';
}

export function renderMessage(type: MessageType, input: TemplateInput): string {
	const when = formatMessageDateTime(input.startsAt, input.timezone);
	const deadline = input.confirmationDueAt
		? formatMessageDateTime(input.confirmationDueAt, input.timezone)
		: 'soon';
	const { shopName: shop, serviceName: service, staffName: staff, manageUrl: link } = input;
	const lines: Record<MessageType, string> = {
		confirmation: `${shop}: your ${service} with ${staff} is booked for ${when}.${link ? ` Manage: ${link}` : ''}`,
		reminder: `${shop}: reminder - your ${service} with ${staff} is ${when}.${link ? ` Need to change? ${link}` : ''}`,
		confirm_request: `${shop}: reply YES to confirm your ${service}, ${when}.${link ? ` To change: ${link}` : ''}`,
		rescheduled: `${shop}: your ${service} with ${staff} is now ${when}.${link ? ` Manage: ${link}` : ''}`,
		cancelled: `${shop}: your ${service} on ${when} has been cancelled. Reply to this text with any questions.`,
		final_warning: `${shop}: reply YES by ${deadline} to keep your ${service} on ${when}, or your spot may go to someone else.`,
		extra_reminder: `${shop}: see you soon - ${service} with ${staff}, ${when}.${link ? ` Need to change? ${link}` : ''}`,
		released: `${shop}: we didn't hear back, so we released your ${service} on ${when}. Reply if you still want to come.`,
	};
	const text = lines[type];
	return input.signOff ? `${text}\n${input.signOff}` : text;
}

export interface WaitlistJoinedInput {
	shopName: string;
	serviceName: string;
	waitlistUrl: string;
	signOff: string | null;
}

export function renderWaitlistJoined(input: WaitlistJoinedInput): string {
	const text = `${input.shopName}: you're on the waitlist for ${input.serviceName}. We'll text if a spot opens - first to tap gets it. View or leave: ${input.waitlistUrl}`;
	return input.signOff ? `${text}\n${input.signOff}` : text;
}

export interface WaitlistOfferInput {
	shopName: string;
	serviceName: string;
	staffName: string;
	startsAt: Instant;
	expiresAt: Instant;
	timezone: TimeZone;
	claimUrl: string;
	signOff: string | null;
}

export function renderWaitlistOffer(input: WaitlistOfferInput): string {
	const when = formatMessageDateTime(input.startsAt, input.timezone);
	const until = formatLocalTime(input.expiresAt, input.timezone);
	const text = `${input.shopName}: a spot opened for ${input.serviceName} with ${input.staffName}, ${when}. First to tap gets it: ${input.claimUrl} (until ${until})`;
	return input.signOff ? `${text}\n${input.signOff}` : text;
}
