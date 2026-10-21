import Link from 'next/link';

export default function NotFound() {
	return (
		<main className="mx-auto grid w-full max-w-lg gap-3 px-4 py-16 text-center">
			<h1 className="text-2xl font-semibold">Page not found</h1>
			<p className="text-sm text-muted-foreground">
				The link may be old or mistyped. If you were booking, use the link the shop sent you.
			</p>
			<Link href="/" className="text-sm font-medium underline underline-offset-4">
				Go to Fullcut
			</Link>
		</main>
	);
}
