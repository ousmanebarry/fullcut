import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { THEME_SCRIPT } from '@/lib/theme';
import './globals.css';

const geistSans = Geist({
	variable: '--font-sans',
	subsets: ['latin'],
});

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin'],
});

export const metadata: Metadata = {
	metadataBase: new URL(process.env.SITE_URL || 'https://fullcut.ca'),
	title: { default: 'Fullcut', template: '%s · Fullcut' },
	applicationName: 'Fullcut',
	description: 'Booking for independent barbers and stylists. Flat price, zero commission.',
	openGraph: {
		type: 'website',
		siteName: 'Fullcut',
		title: 'Fullcut · Fill your chair. Keep your clients.',
		description:
			'Booking for independent barbers and stylists. Flat price, zero commission, your clients stay yours.',
	},
	twitter: { card: 'summary_large_image' },
	appleWebApp: {
		capable: true,
		title: 'Fullcut',
		statusBarStyle: 'default',
	},
};

export const viewport: Viewport = {
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
	return (
		// The theme script sets class, color-scheme and theme-color before hydration.
		<html
			lang="en"
			className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
			suppressHydrationWarning
		>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</head>
			<body className="flex min-h-full flex-col">{children}</body>
		</html>
	);
}
