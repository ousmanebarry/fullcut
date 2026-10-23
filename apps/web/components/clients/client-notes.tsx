'use client';

import { Trash2Icon } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { addNoteAction, deleteNoteAction } from '@/app/dashboard/clients/actions';
import { TextAreaField } from '@/components/forms/fields';
import { Button } from '@/components/ui/button';
import { MAX_NOTE_LENGTH } from '@/lib/clients/schemas';
import type { ClientNoteView } from '@/lib/clients/types';

/** Private notes staff keep about a client, newest first. */
export function ClientNotes({
	clientId,
	notes,
	canAdd,
}: {
	clientId: string;
	notes: ClientNoteView[];
	canAdd: boolean;
}) {
	const [error, setError] = useState<string>();
	const [pending, startTransition] = useTransition();

	// Read from the form, not state: text typed before hydration must still count.
	const add = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = event.currentTarget;
		const body = String(new FormData(form).get('body') ?? '');
		if (!body.trim()) {
			setError('Write a note first.');
			return;
		}
		startTransition(async () => {
			const result = await addNoteAction({ clientId, body });
			if (!result.ok) {
				setError(result.message);
				return;
			}
			setError(undefined);
			form.reset();
			toast.success(result.message);
		});
	};

	const remove = (noteId: string) => {
		startTransition(async () => {
			const result = await deleteNoteAction(noteId);
			if (result.ok) toast.success(result.message);
			else toast.error(result.message);
		});
	};

	return (
		<div className="grid gap-3">
			{canAdd ? (
				<form onSubmit={add} className="grid gap-2" noValidate>
					<TextAreaField
						name="body"
						label="Add a note"
						hint="Only your team sees these, e.g. “#2 fade, likes it short on top”."
						maxLength={MAX_NOTE_LENGTH}
						error={error}
						rows={2}
					/>
					<div>
						<Button type="submit" size="sm" disabled={pending}>
							Add note
						</Button>
					</div>
				</form>
			) : null}
			{notes.length === 0 ? (
				<p className="text-sm text-muted-foreground">No notes yet.</p>
			) : (
				<ul className="grid gap-2">
					{notes.map((note) => (
						<li
							key={note.id}
							data-testid="client-note"
							className="flex items-start gap-2 rounded-lg border p-3 text-sm"
						>
							<div className="grid min-w-0 flex-1 gap-1">
								<p className="break-words whitespace-pre-line">{note.body}</p>
								<p className="text-xs text-muted-foreground">
									{note.authorName} · {note.createdLabel}
								</p>
							</div>
							{note.canDelete ? (
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Delete note"
									disabled={pending}
									onClick={() => remove(note.id)}
								>
									<Trash2Icon aria-hidden="true" />
								</Button>
							) : null}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
