import { Logo } from '@/components/brand/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return (
		<main className="flex flex-1 flex-col items-center px-4 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-10 sm:justify-center sm:bg-muted/40">
			<div className="grid w-full max-w-sm gap-8 sm:max-w-md sm:rounded-2xl sm:border sm:bg-card sm:p-8 sm:shadow-sm">
				<Logo className="text-lg" />
				<div className="grid gap-6">{children}</div>
			</div>
		</main>
	);
}
