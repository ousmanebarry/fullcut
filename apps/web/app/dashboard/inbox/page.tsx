import { CheckIcon, PhoneIcon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { ListSkeleton } from '@/components/skeletons';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { requireShopMember } from '@/lib/auth/session';
import { unhandledReplies } from '@/lib/messaging/queries';
import { createClient } from '@/lib/supabase/server';
import { timeZone } from '@/lib/time';
import { markReplyHandledAction } from './actions';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
	return (
		<div className="mx-auto grid w-full max-w-3xl gap-4">
			<PageHeader
				title="Inbox"
				description="Text replies from clients that need a person. STOP, START and YES are handled automatically."
			/>
			<Suspense fallback={<ListSkeleton label="Loading messages…" />}>
				<Replies />
			</Suspense>
		</div>
	);
}

async function Replies() {
	const ctx = await requireShopMember();
	const replies = await unhandledReplies(
		await createClient(),
		ctx.shop.id,
		timeZone(ctx.shop.timezone),
	);

	if (replies.length === 0) {
		return (
			<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
				No replies waiting.
			</p>
		);
	}

	return (
		<ul className="grid gap-3" aria-label="Unhandled replies">
			{replies.map((reply) => (
				<li key={reply.id} className="grid gap-3 rounded-lg border p-4" data-testid="inbox-reply">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<span className="font-medium">
							{reply.clientId && reply.clientName ? (
								<Link href={`/dashboard/clients/${reply.clientId}`} className="hover:underline">
									{reply.clientName}
								</Link>
							) : (
								(reply.clientName ?? 'Unknown client')
							)}
						</span>
						<span className="text-sm text-muted-foreground">{reply.receivedLabel}</span>
					</div>
					<p className="whitespace-pre-line break-words">{reply.body}</p>
					<div className="flex flex-wrap gap-2">
						{reply.fromPhone ? (
							<a
								href={`tel:${reply.fromPhone}`}
								className={buttonVariants({ variant: 'outline', size: 'sm' })}
							>
								<PhoneIcon aria-hidden="true" />
								Call {reply.fromPhone}
							</a>
						) : null}
						<form action={markReplyHandledAction}>
							<input type="hidden" name="id" value={reply.id} />
							<Button type="submit" size="sm" variant="secondary">
								<CheckIcon aria-hidden="true" />
								Mark handled
							</Button>
						</form>
					</div>
				</li>
			))}
		</ul>
	);
}
