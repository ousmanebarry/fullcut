import { ImageResponse } from 'next/og';
import { getPublicEnv } from '@/lib/env';
import { getCachedPublicShop } from '@/lib/public-booking/cached';

export const alt = 'Book an appointment online';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

// The server fetches the logo, so only our own storage is trusted (owners can enter any https URL).
function trustedLogoUrl(logoUrl: string | null): string | null {
	if (!logoUrl) return null;
	try {
		return new URL(logoUrl).origin === new URL(getPublicEnv().supabaseUrl).origin ? logoUrl : null;
	} catch {
		return null;
	}
}

export default async function ShopOpengraphImage({
	params,
}: {
	params: Promise<{ shopSlug: string }>;
}) {
	const { shopSlug } = await params;
	const shop = await getCachedPublicShop(shopSlug);
	const name = shop?.name ?? 'Fullcut';
	const logoUrl = trustedLogoUrl(shop?.logoUrl ?? null);
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
			{logoUrl ? (
				<img
					src={logoUrl}
					alt=""
					width={128}
					height={128}
					style={{ borderRadius: 24, objectFit: 'cover' }}
				/>
			) : (
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						width: 128,
						height: 128,
						borderRadius: 24,
						background: '#fafafa',
						color: '#0a0a0a',
						fontSize: 64,
						fontWeight: 700,
					}}
				>
					{name.slice(0, 1).toUpperCase()}
				</div>
			)}
			<div style={{ fontSize: 80, fontWeight: 700, marginTop: 48, lineHeight: 1.1 }}>{name}</div>
			<div style={{ fontSize: 40, marginTop: 24, opacity: 0.8 }}>
				{shop?.address ?? 'Book an appointment online'}
			</div>
		</div>,
		size,
	);
}
