import Link from 'next/link';

export default function ShopNotFound() {
	return (
		<main className="mx-auto grid w-full max-w-lg gap-3 px-4 py-16 text-center">
			<h1 className="text-2xl font-semibold">This booking page isn&apos;t available</h1>
			<p className="text-sm text-muted-foreground">
				Check the link you were sent, or contact the shop directly.
			</p>
			<Link href="/" className="text-sm font-medium underline underline-offset-4">
				Go to Fullcut
			</Link>
		</main>
	);
}
