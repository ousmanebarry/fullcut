import Link from 'next/link';

export default function DashboardNotFound() {
	return (
		<div className="mx-auto grid w-full max-w-lg gap-3 py-16 text-center">
			<h1 className="text-2xl font-semibold">Not found</h1>
			<p className="text-sm text-muted-foreground">
				It may have been deleted, or your account doesn&apos;t have access to it.
			</p>
			<Link href="/dashboard" className="text-sm font-medium underline underline-offset-4">
				Back to today
			</Link>
		</div>
	);
}
