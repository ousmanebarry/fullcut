/** Off-screen and skipped by keyboard and screen readers; bots fill it in. */
export function HoneypotField({
	id,
	value,
	onChange,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
			<label htmlFor={id}>Website</label>
			<input
				id={id}
				name="website"
				tabIndex={-1}
				autoComplete="off"
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		</div>
	);
}
