import type { Metadata } from 'next';
import { Suspense } from 'react';
import { requireShopOwner } from '@/lib/auth/session';
import { listServices } from '@/lib/shop/queries';
import { AddServiceForm, ServiceRow } from './service-forms';

export const metadata: Metadata = { title: 'Services · Fullcut' };

export default function ServicesSettingsPage() {
	return (
		<div className="grid max-w-2xl gap-4">
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">Services</h1>
				<p className="text-sm text-muted-foreground">Clients see services in this order.</p>
			</div>
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
				<ServiceList />
			</Suspense>
		</div>
	);
}

async function ServiceList() {
	const ctx = await requireShopOwner();
	const services = await listServices(ctx);

	return (
		<>
			{services.length === 0 ? (
				<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					Add your first service so clients have something to book.
				</p>
			) : (
				<ul className="grid gap-3">
					{services.map((service, index) => (
						<ServiceRow
							key={service.id}
							service={service}
							currency={ctx.shop.currency}
							isFirst={index === 0}
							isLast={index === services.length - 1}
						/>
					))}
				</ul>
			)}
			<AddServiceForm currency={ctx.shop.currency} />
		</>
	);
}
