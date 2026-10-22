import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { FormSkeleton } from '@/components/skeletons';
import { requireShopMember } from '@/lib/auth/session';
import { editableStaff, listRules } from '@/lib/shop/queries';
import { rulesToHours } from '@/lib/shop/hours';
import { cn } from '@/lib/utils';
import { HoursForm } from './hours-form';

export const metadata: Metadata = { title: 'Hours' };

export default function HoursSettingsPage({
	searchParams,
}: PageProps<'/dashboard/settings/hours'>) {
	return (
		<div className="grid max-w-2xl gap-4">
			<div className="grid gap-1">
				<h1 className="text-2xl font-semibold">Hours</h1>
				<p className="text-sm text-muted-foreground">
					Weekly hours in your shop&apos;s timezone. Add more than one range to a day for breaks.
				</p>
			</div>
			<Suspense fallback={<FormSkeleton fields={7} />}>
				<Hours searchParams={searchParams} />
			</Suspense>
		</div>
	);
}

async function Hours({
	searchParams,
}: Pick<PageProps<'/dashboard/settings/hours'>, 'searchParams'>) {
	const ctx = await requireShopMember();
	const [staff, params] = await Promise.all([editableStaff(ctx), searchParams]);

	if (staff.length === 0) {
		return (
			<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
				{ctx.role === 'owner'
					? 'Add a staff member first, then set their hours.'
					: "Your login isn't linked to a staff profile yet. Ask the shop owner."}
			</p>
		);
	}

	const selected =
		staff.find((s) => s.id === params.staff) ?? staff.find((s) => s.id === ctx.staffId) ?? staff[0];
	if (!selected) return null;
	const rules = await listRules(ctx, selected.id);

	return (
		<>
			{staff.length > 1 ? (
				<nav aria-label="Staff" className="flex flex-wrap gap-2">
					{staff.map((member) => (
						<Link
							key={member.id}
							href={`/dashboard/settings/hours?staff=${member.id}`}
							aria-current={member.id === selected.id ? 'page' : undefined}
							className={cn(
								'rounded-full border px-3 py-1.5 text-sm hover:bg-accent',
								member.id === selected.id &&
									'bg-primary text-primary-foreground hover:bg-primary/90',
							)}
						>
							{member.display_name}
						</Link>
					))}
				</nav>
			) : null}
			<h2 className="font-medium">{selected.display_name}</h2>
			<HoursForm key={selected.id} staffId={selected.id} initialHours={rulesToHours(rules)} />
		</>
	);
}
