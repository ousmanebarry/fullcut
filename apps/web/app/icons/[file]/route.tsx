import { monogramIcon } from '@/lib/pwa/monogram-icon';

const ICONS = {
	'icon-192.png': { size: 192, maskable: false },
	'icon-512.png': { size: 512, maskable: false },
	'maskable-512.png': { size: 512, maskable: true },
} as const;

type IconFile = keyof typeof ICONS;

export function generateStaticParams(): { file: IconFile }[] {
	return Object.keys(ICONS).map((file) => ({ file: file as IconFile }));
}

export async function GET(_request: Request, { params }: RouteContext<'/icons/[file]'>) {
	const { file } = await params;
	if (!(file in ICONS)) return new Response('Not found', { status: 404 });
	const { size, maskable } = ICONS[file as IconFile];
	return monogramIcon(size, { maskable });
}
