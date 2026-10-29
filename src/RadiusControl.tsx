import { flushSync } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
export default function RadiusControl({ value, disabled, onCommit }: { value: number; disabled: boolean; onCommit: (km: number) => void }) {
  const [editing, setEditing] = useState(false), [draft, setDraft] = useState(''), [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const finishing = useRef(false), returnFocus = useRef(false);
  useEffect(() => {
    if (editing) { finishing.current = false; input.current?.focus({ preventScroll: true }); input.current?.select(); }
    else if (returnFocus.current) { returnFocus.current = false; trigger.current?.focus({ preventScroll: true }); }
  }, [editing]);
  const previousValue = useRef(value);
  useEffect(() => {
    if (previousValue.current !== value) { previousValue.current = value; setDraft(String(Number(value.toFixed(3)))); setError(''); if (editing) close(false); }
  }, [value]);
  function close(focus: boolean) { finishing.current = true; returnFocus.current = focus; setEditing(false); setError(''); }
  function commit(focus: boolean) {
    if (finishing.current) return;
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < 0.5 || next > 10) { setError('Enter a radius from 0.5 to 10 km.'); return; }
    close(focus); if (Math.abs(next - value) > 0.000001) onCommit(next);
  }
  // The first outside tap finishes editing only. It cannot also generate a route,
  // open Settings or start a Leaflet drag. Tab/blur still commits a valid draft.
  useEffect(() => {
    if (!editing) return;
    const outside = (event: Event) => event.target instanceof Node && !root.current?.contains(event.target);
    const down = (event: PointerEvent) => {
      if (!outside(event)) return;
      if (event.target instanceof Element && event.target.closest('.circle-handle')) {
        const next = Number(draft);
        // An intentional handle drag finishes a valid draft or discards invalid
        // text first, so gesture snapshots and the readout share committed state.
        flushSync(() => { if (draft.trim() && Number.isFinite(next) && next >= 0.5 && next <= 10) commit(false); else close(false); });
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
    };
    const click = (event: MouseEvent) => { if (outside(event)) { event.preventDefault(); event.stopImmediatePropagation(); commit(false); } };
    document.addEventListener('pointerdown', down, true); document.addEventListener('click', click, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('click', click, true); };
  });
  useEffect(() => { if (disabled && editing) close(false); }, [disabled, editing]);
  return <div ref={root} className={`radius-readout ${editing ? 'editing number-control' : ''}`} onBlur={event => { if (editing && !event.currentTarget.contains(event.relatedTarget as Node | null)) commit(false); }}>
    <span className="radius-label">Circle size</span>
    {editing ? <><input ref={input} id="circle-radius-input" type="number" inputMode="decimal" enterKeyHint="done" aria-label="Circle radius (km)" min="0.5" max="10" step="any" value={draft} disabled={disabled} aria-invalid={!!error} aria-describedby={`radius-unit${error ? ' radius-error' : ''}`} onChange={event => { setDraft(event.target.value); setError(''); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(true); } if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); } }} /><small id="radius-unit">km radius</small><div className="radius-edit-actions"><button type="button" aria-label="Done editing radius" disabled={disabled} onClick={() => commit(true)}>Done</button><button type="button" aria-label="Cancel radius edit" disabled={disabled} onClick={() => close(true)}>Cancel</button></div>{error && <span className="input-error" id="radius-error" role="alert">{error}</span>}</> : <button ref={trigger} type="button" aria-label="Edit circle radius" disabled={disabled} title="Enter radius in kilometers" onClick={() => { setDraft(String(Number(value.toFixed(3)))); setError(''); setEditing(true); }}><span>{value.toFixed(2)}</span><small>km radius</small></button>}
  </div>;
}
