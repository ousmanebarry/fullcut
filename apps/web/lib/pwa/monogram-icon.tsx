import { ImageResponse } from 'next/og';

/** Placeholder "F" monogram; `maskable` keeps the letter inside the 80% safe zone. */
export function monogramIcon(size: number, { maskable = false } = {}): ImageResponse {
	return new ImageResponse(
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: '#0e6b6e',
				color: '#ffffff',
				fontSize: Math.round(size * (maskable ? 0.45 : 0.62)),
				lineHeight: 1,
			}}
		>
			F
		</div>,
		{ width: size, height: size },
	);
}
