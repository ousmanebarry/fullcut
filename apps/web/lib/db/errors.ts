export interface DbErrorLike {
	code?: string;
	message?: string;
}

export interface UserFacingError {
	field?: string;
	message: string;
}

const CONSTRAINT_MESSAGES: Record<string, UserFacingError> = {
	shops_slug_unique: { field: 'slug', message: 'That link is already taken. Try another.' },
	shops_slug_format: {
		field: 'slug',
		message: 'Use lowercase letters, numbers and single hyphens.',
	},
	shops_phone_e164_format: { field: 'phone', message: 'Enter a valid phone number.' },
	shops_logo_url_https: { field: 'logoUrl', message: 'Use a full https:// link.' },
	shops_slot_step_valid: { field: 'slotStepMinutes', message: 'Choose a slot step.' },
	shops_min_lead_valid: { field: 'minLeadMinutes', message: 'Lead time can be at most 7 days.' },
	shops_max_horizon_valid: { field: 'maxHorizonDays', message: 'Choose between 1 and 365 days.' },
	shops_cancel_cutoff_valid: {
		field: 'cancelCutoffHours',
		message: 'Choose between 0 and 168 hours.',
	},
	shops_max_active_bookings_valid: {
		field: 'maxActiveBookingsPerPhone',
		message: 'Choose between 1 and 20 bookings.',
	},
	bookings_client_notes_length: {
		field: 'notes',
		message: 'Keep notes under 500 characters.',
	},
	clients_shop_phone_unique: { field: 'phone', message: 'Another client already has this number.' },
	clients_phone_e164_format: { field: 'phone', message: 'Enter a valid phone number.' },
	clients_email_normalized: { field: 'email', message: 'Enter a valid email address.' },
	client_notes_body_length: { field: 'body', message: 'Notes must be 1 to 1000 characters.' },
	services_duration_positive: {
		field: 'durationMinutes',
		message: 'Duration must be more than 0.',
	},
	services_price_nonnegative: { field: 'price', message: 'Price cannot be negative.' },
	availability_rules_time_order: { message: 'Start must be before end.' },
	time_off_time_order: { field: 'endDate', message: 'End must be after start.' },
};

const RAISED_MESSAGES: Record<string, string> = {
	onboarding_already_member: 'You already have a shop.',
	onboarding_no_services: 'Add at least one service.',
	availability_rules_forbidden: 'You can only change your own hours.',
	staff_not_found: 'That staff member no longer exists.',
	client_not_found: 'That client no longer exists.',
	merge_forbidden: 'Only the shop owner can merge clients.',
	merge_same_client: 'Choose two different clients.',
	merge_anonymised_client: 'Deleted clients cannot be merged.',
	anonymise_forbidden: "Only the shop owner can delete a client's data.",
	client_has_upcoming_bookings: 'Cancel their upcoming bookings first.',
	demo_shop_locked: "The demo shop's profile, link and team can't be changed.",
};

/** Maps a Postgres/PostgREST error to a message safe to show, keyed to a form field where possible. */
export function toUserFacingError(error: DbErrorLike): UserFacingError {
	const message = error.message ?? '';
	const constraint = /constraint "([^"]+)"/.exec(message)?.[1];
	if (constraint && CONSTRAINT_MESSAGES[constraint]) return CONSTRAINT_MESSAGES[constraint];

	const raised = RAISED_MESSAGES[message];
	if (raised) return { message: raised };

	if (error.code === '42501') return { message: "You don't have permission to do that." };
	if (error.code === '23503') return { message: 'That item no longer exists.' };
	if (error.code === '23P01') return { message: 'That time was just taken. Pick another.' };
	if (error.code === 'FC001') return { message: 'This client has too many upcoming bookings.' };
	return { message: 'Something went wrong. Try again.' };
}
