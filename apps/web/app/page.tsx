import { DemoEntry } from '@/components/demo/demo-entry';
import { getDemoShopSlug } from '@/lib/env';

export default function Home() {
	const demoShopSlug = getDemoShopSlug();
	return (
		<main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16">
			<h1 className="font-heading text-4xl font-semibold tracking-tight">Fullcut</h1>
			<p className="text-lg text-muted-foreground">
				Booking for independent barbers and stylists. Flat price, zero commission, your clients stay
				yours.
			</p>
			<p className="text-sm text-muted-foreground">Coming soon.</p>
			{demoShopSlug && <DemoEntry shopSlug={demoShopSlug} />}
		</main>
	);
}
