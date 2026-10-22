import { ImageResponse } from 'next/og';

export const alt = 'Fullcut: booking for independent barbers and stylists';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
	return new ImageResponse(
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'center',
				padding: 96,
				background: '#0a0a0a',
				color: '#fafafa',
				fontFamily: 'sans-serif',
			}}
		>
			<div style={{ fontSize: 40, color: '#5fd0cb' }}>Fullcut</div>
			<div style={{ fontSize: 80, fontWeight: 700, marginTop: 24, lineHeight: 1.1 }}>
				Fill your chair. Keep your clients.
			</div>
			<div style={{ fontSize: 36, marginTop: 32, opacity: 0.8 }}>
				Booking for independent barbers and stylists. Flat price, zero commission.
			</div>
		</div>,
		size,
	);
}
