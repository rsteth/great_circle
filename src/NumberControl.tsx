import { useEffect, useState } from 'react';
export default function NumberControl({ id, label, value, min, max, step, onCommit }: { id: string; label: string; value: number; min: number; max: number; step: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(String(value)); setError(''); }, [value]);
  function commit() {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < min || next > max) { setError(`Enter ${min}–${max}.`); return; }
    setError('');
    if (next !== value) onCommit(next);
    else setDraft(String(value));
  }
  return <label className="number-control" htmlFor={id}><span>{label}</span><input id={id} type="number" aria-label={label} inputMode="decimal" min={min} max={max} step={step} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape') { event.preventDefault(); setDraft(String(value)); setError(''); } }} />{error && <small id={`${id}-error`} className="input-error" role="alert">{error}</small>}</label>;
}
