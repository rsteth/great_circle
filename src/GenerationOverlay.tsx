import { useEffect, useRef } from 'react';
import { LoaderCircle, X } from 'lucide-react';

/** Native modal keeps the planning page inert, including map and navigation links. */
export default function GenerationOverlay({ status, onCancel }: { status: string; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    cancel.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      document.querySelector<HTMLButtonElement>('button.primary')?.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="generation-overlay" aria-modal="true" aria-labelledby="generation-title" aria-describedby="generation-detail generation-cancel-note" onCancel={event => { event.preventDefault(); onCancel(); }} onKeyDown={event => {
    if (event.key === 'Tab') { event.preventDefault(); cancel.current?.focus(); }
  }}>
    <div className="generation-card">
      <LoaderCircle size={32} className="spin" aria-hidden="true" />
      <h2 id="generation-title">Generating loop</h2>
      <p id="generation-detail" role="status" aria-label="Generation progress" aria-live="polite">{status}</p>
      <p id="generation-cancel-note">You can cancel and keep your circle. A server request may still finish within its time limit.</p>
      <button ref={cancel} type="button" className="primary cancel" onClick={onCancel}><X size={18} /> Cancel generation</button>
    </div>
  </dialog>;
}
