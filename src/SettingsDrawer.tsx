import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { X } from 'lucide-react';
export default function SettingsDrawer({ open, onClose, trigger, focusId, children }: { open: boolean; onClose: () => void; trigger: RefObject<HTMLButtonElement | null>; focusId?: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const backdropDown = useRef(false);
  const callback = useRef(onClose);
  useEffect(() => { callback.current = onClose; }, [onClose]);
  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    const scroll = window.scrollY;
    const body = document.body;
    const properties = ['position', 'top', 'left', 'right', 'width', 'overflow'] as const;
    const previous = properties.map(property => [property, body.style.getPropertyValue(property)] as const);
    body.style.position = 'fixed'; body.style.top = `${-scroll}px`; body.style.left = '0'; body.style.right = '0'; body.style.width = '100%'; body.style.overflow = 'hidden';
    element.showModal();
    const focus = focusId ? element.querySelector<HTMLElement>(`#${focusId}`) : close.current;
    focus?.focus({ preventScroll: true });
    return () => {
      element.close();
      for (const [property, value] of previous) {
        if (value) body.style.setProperty(property, value);
        else body.style.removeProperty(property);
      }
      window.scrollTo(0, scroll);
      const destination = trigger.current?.isConnected ? trigger.current : document.querySelector<HTMLButtonElement>('button.primary');
      destination?.focus({ preventScroll: true });
    };
  }, [open, focusId, trigger]);
  function outside(x: number, y: number) {
    const bounds = dialog.current?.getBoundingClientRect();
    return bounds && (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom);
  }
  return <dialog ref={dialog} id="route-settings-drawer" className="settings-drawer" aria-labelledby="drawer-title" aria-modal="true" onCancel={event => { event.preventDefault(); callback.current(); }} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); callback.current(); return; }
    if (event.key === 'Tab') {
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button,a[href],input,select,textarea,summary,[tabindex]')].filter(item => item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length > 0);
      const first = items[0], last = items.at(-1), active = document.activeElement;
      if (event.shiftKey && active === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last && first) { event.preventDefault(); first.focus(); }
    }
  }} onPointerDown={event => { backdropDown.current = event.target === event.currentTarget && !!outside(event.clientX, event.clientY); }} onPointerUp={event => { if (backdropDown.current && event.target === event.currentTarget && outside(event.clientX, event.clientY)) callback.current(); backdropDown.current = false; }}>
    <header className="drawer-heading"><h2 id="drawer-title">Route settings</h2><button ref={close} type="button" onClick={onClose} aria-label="Close settings"><X size={20} /></button></header>
    <div className="drawer-content">{children}</div>
    <div className="drawer-footer"><button type="button" className="primary" onClick={onClose}>Done</button></div>
  </dialog>;
}
