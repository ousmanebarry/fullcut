import { DownloadIcon } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { requireShopOwner } from '@/lib/auth/session';
import { EXPORT_SOURCES } from '@/lib/export/tables';
import { createClient } from '@/lib/supabase/server';
import { formatSlotLabel, instantFromIso, timeZone } from '@/lib/time';

export const metadata: Metadata = { title: 'Export data · Fullcut' };

export default function ExportPage() {
	return (
		<div className="grid max-w-xl gap-4">
			<h1 className="text-2xl font-semibold">Export data</h1>
			<Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
				<ExportContent />
			</Suspense>
		</div>
	);
}

async function ExportContent() {
	const { shop } = await requireShopOwner();
	const db = await createClient();
	const { data, error } = await db
		.from('audit_events')
		.select('id, actor_email, created_at')
		.eq('shop_id', shop.id)
		.eq('action', 'export')
		.order('created_at', { ascending: false })
		.limit(10);
	if (error) throw error;

	const zone = timeZone(shop.timezone);
	return (
		<>
			<p className="text-sm text-muted-foreground">
				Your clients and your bookings are yours. Download everything as spreadsheets (CSV in a ZIP)
				any time: it opens in Excel, Numbers and Google Sheets, and includes IDs so it can be
				imported elsewhere.
			</p>
			<ul className="grid list-inside list-disc gap-0.5 text-sm">
				{EXPORT_SOURCES.map((source) => (
					<li key={source.file}>{source.file}</li>
				))}
			</ul>
			<form method="post" action="/dashboard/settings/export/download">
				<button type="submit" className={buttonVariants({ size: 'lg' })}>
					<DownloadIcon aria-hidden="true" />
					Export all data
				</button>
			</form>
			<section className="grid gap-2" aria-labelledby="recent-exports">
				<h2 id="recent-exports" className="font-medium">
					Recent exports
				</h2>
				{data.length === 0 ? (
					<p className="text-sm text-muted-foreground">No exports yet.</p>
				) : (
					<ul className="grid gap-1 text-sm">
						{data.map((event) => (
							<li key={event.id}>
								{formatSlotLabel(instantFromIso(event.created_at), zone)}
								<span className="text-muted-foreground"> · {event.actor_email ?? 'Unknown'}</span>
							</li>
						))}
					</ul>
				)}
			</section>
		</>
	);
}
