export interface ContactValues {
	name: string;
	phone: string;
	email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Client-side checks for the booking details step; `isValidPhone` is null until the phone library loads. */
export function validateDetails(
	values: ContactValues,
	isValidPhone: ((phone: string) => boolean) | null,
): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!values.name.trim()) errors.name = 'Enter your name.';
	if (!values.phone.trim()) errors.phone = 'Enter your mobile number.';
	else if (isValidPhone && !isValidPhone(values.phone))
		errors.phone = 'Enter a valid mobile number.';
	if (values.email.trim() && !EMAIL.test(values.email.trim())) {
		errors.email = 'Enter a valid email or leave it blank.';
	}
	return errors;
}
