export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'fullcut:theme';
const CHANGE_EVENT = 'fullcut:theme-change';
const THEME_COLORS = { light: '#ffffff', dark: '#0a0a0a' };

// Inline in <head>: applies the theme (and browser bar colour) before first paint, then follows OS and other-tab changes.
export const THEME_SCRIPT = `(()=>{const k=${JSON.stringify(STORAGE_KEY)},c=${JSON.stringify(THEME_COLORS)},m=matchMedia('(prefers-color-scheme: dark)');function a(){let p=null;try{p=localStorage.getItem(k)}catch{}const d=p==='dark'||(p!=='light'&&m.matches),r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';let t=document.querySelector('meta[name="theme-color"]');if(!t){t=document.createElement('meta');t.name='theme-color';document.head.appendChild(t)}t.content=d?c.dark:c.light;dispatchEvent(new Event(${JSON.stringify(CHANGE_EVENT)}))}a();m.addEventListener('change',a);addEventListener('storage',e=>{if(e.key===k)a()})})()`;

export function getThemePreference(): ThemePreference {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'light' || stored === 'dark') return stored;
	} catch {
		// Storage can be blocked (private mode, cookie settings).
	}
	return 'system';
}

export function getResolvedTheme(): 'light' | 'dark' {
	return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function setThemePreference(preference: ThemePreference) {
	try {
		if (preference === 'system') localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, preference);
	} catch {
		// Still apply for this page view.
	}
	const dark =
		preference === 'dark' ||
		(preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
	const root = document.documentElement;
	root.classList.toggle('dark', dark);
	root.style.colorScheme = dark ? 'dark' : 'light';
	document
		.querySelector('meta[name="theme-color"]')
		?.setAttribute('content', dark ? THEME_COLORS.dark : THEME_COLORS.light);
	dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeTheme(onChange: () => void) {
	addEventListener(CHANGE_EVENT, onChange);
	return () => removeEventListener(CHANGE_EVENT, onChange);
}
