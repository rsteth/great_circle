import { useEffect, useRef, useState } from 'react';
export default function RadiusControl({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (km: number) => void }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const finishing = useRef(false), returnFocus = useRef(false);
  useEffect(() => {
    if (editing) { finishing.current = false; input.current?.focus({ preventScroll: true }); input.current?.select(); }
    else if (returnFocus.current) { returnFocus.current = false; trigger.current?.focus({ preventScroll: true }); }
  }, [editing]);
  function close(focus: boolean) { finishing.current = true; returnFocus.current = focus; setEditing(false); setError(''); }
  function commit(focus: boolean) {
    if (finishing.current) return;
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < 0.5 || next > 100) { setError('Enter a radius from 0.5 to 100 km.'); return; }
    close(focus); if (Math.abs(next - value) > 0.000001) onCommit(next);
  }
  return <div className={`radius-readout ${editing ? 'editing number-control' : ''}`}>
    {editing ? <><input ref={input} id="circle-radius-input" type="number" inputMode="decimal" aria-label="Circle radius (km)" min="0.5" max="100" step="any" value={draft} disabled={disabled} aria-invalid={!!error} aria-describedby={`radius-unit${error ? ' radius-error' : ''}`} onChange={event => setDraft(event.target.value)} onBlur={() => commit(false)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(true); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }} /><small id="radius-unit">km radius</small>{error && <span className="input-error" id="radius-error" role="alert">{error}</span>}</> : <button ref={trigger} type="button" aria-label="Edit circle radius" disabled={disabled} title="Enter radius in kilometers" onClick={() => { setDraft(String(Number(value.toFixed(3)))); setError(''); setEditing(true); }}><span>{value.toFixed(2)}</span><small>km radius</small></button>}
  </div>;
}
