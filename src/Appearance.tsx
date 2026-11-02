import { useEffect, useRef, useState } from 'react';
import { Accessibility, Moon, Sun, X } from 'lucide-react';
const prefix = 'great-circle.appearance.v1.';
const palettes = [['standard', 'Standard'], ['red-green', 'Red–green friendly (protan/deutan)'], ['blue-yellow', 'Blue–yellow friendly (tritan)'], ['high-contrast', 'High contrast']] as const;
function save(key: string, value: string) { try { localStorage.setItem(prefix + key, value); } catch { /* Preferences still work for this visit. */ } }
export default function Appearance() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light');
  const [palette, setPalette] = useState(document.documentElement.dataset.palette ?? 'standard');
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const explicit = useRef(document.documentElement.dataset.themeExplicit === 'true');
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => { if (!explicit.current) { const next = media.matches ? 'dark' : 'light'; document.documentElement.dataset.theme = next; setTheme(next); } };
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#20231f' : '#f6f3eb'); }, [theme]);
  function close() { dialog.current?.close(); }
  function deviceTheme() {
    explicit.current = false; document.documentElement.dataset.themeExplicit = 'false';
    try { localStorage.removeItem(prefix + 'theme'); } catch { /* System choice still works for this visit. */ }
    const next = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = next; setTheme(next);
  }
  return <div className="appearance-controls">
    <button className="appearance-button" type="button" aria-label="Dark mode" aria-pressed={theme === 'dark'} title="Dark mode" onClick={() => { const next = theme === 'dark' ? 'light' : 'dark'; explicit.current = true; document.documentElement.dataset.theme = next; document.documentElement.dataset.themeExplicit = 'true'; setTheme(next); save('theme', next); }}>{theme === 'dark' ? <Moon size={20} aria-hidden="true" /> : <Sun size={20} aria-hidden="true" />}</button>
    <button ref={trigger} className="appearance-button" type="button" aria-label="Accessibility" title="Accessibility" aria-haspopup="dialog" onClick={() => { dialog.current?.showModal(); dialog.current?.querySelector<HTMLInputElement>('input:checked')?.focus(); }}><Accessibility size={21} aria-hidden="true" /></button>
    <dialog className="appearance-dialog" ref={dialog} aria-labelledby="appearance-title" aria-describedby="appearance-description" onClose={() => trigger.current?.focus()} onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const stops = [...event.currentTarget.querySelectorAll<HTMLElement>('button,input:checked')];
        const index = stops.indexOf(document.activeElement as HTMLElement);
        event.preventDefault(); stops[(index + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]?.focus();
      }}>
      <div className="appearance-heading"><h2 id="appearance-title">Accessibility</h2><button type="button" className="appearance-button" aria-label="Close accessibility" onClick={close}><X size={20} aria-hidden="true" /></button></div>
      <p id="appearance-description">Choose a palette for easier distinction. These options change interface colors, not map tiles. Labels and shapes remain available in every palette.</p>
      <fieldset><legend>Color presentation</legend>{palettes.map(([value, label]) => <label className="palette-option" key={value}><input type="radio" name="color-presentation" value={value} checked={palette === value} onChange={() => { setPalette(value); document.documentElement.dataset.palette = value; save('palette', value); }} /><span>{label}</span></label>)}</fieldset>
      <button className="device-theme-button" type="button" onClick={deviceTheme}>Use device theme</button><p className="appearance-note">Light and dark mode are independent of your palette choice.</p>
    </dialog>
  </div>;
}
