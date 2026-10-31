/** @jsxImportSource react */
import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '#ui/components/ui/button.tsx';

const WIDTH_KEY = 'autocatalog-sidebar-width';

const COLLAPSED_KEY = 'autocatalog-sidebar-collapsed';

const DEFAULT_WIDTH = 18.75; // rem, Starlight's --sl-sidebar-width

const MIN_WIDTH = 12;

const MAX_WIDTH = 28;

const rem = (px: number) => px / 16;

/**
 * Collapse and drag-resize the Starlight sidebar. Width and collapsed state
 * persist in localStorage. The chosen width is `--ac-sidebar-width`, which the
 * theme maps onto Starlight's `--sl-sidebar-width` unless
 * `data-sidebar="collapsed"` on `<html>` zeros it.
 */
export function SidebarControls() {
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const storedWidth = Number(localStorage.getItem(WIDTH_KEY));
    const storedCollapsed = localStorage.getItem(COLLAPSED_KEY) === '1';

    if (Number.isFinite(storedWidth) && storedWidth >= MIN_WIDTH && storedWidth <= MAX_WIDTH) {
      document.documentElement.style.setProperty('--ac-sidebar-width', `${storedWidth}rem`);
    }

    document.documentElement.dataset.sidebar = storedCollapsed ? 'collapsed' : 'open';
    setCollapsed(storedCollapsed);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;

    const onMove = (event: PointerEvent) => {
      if (!drag.current) return;

      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, drag.current.startWidth + rem(event.clientX - drag.current.startX)),
      );

      document.documentElement.style.setProperty('--ac-sidebar-width', `${next}rem`);
    };

    const onUp = () => {
      if (!drag.current) return;

      drag.current = null;
      document.body.classList.remove('ac-sidebar-resizing');

      const width = getComputedStyle(document.documentElement)
        .getPropertyValue('--sl-sidebar-width')
        .trim();

      const remValue = Number.parseFloat(width);

      if (Number.isFinite(remValue)) localStorage.setItem(WIDTH_KEY, String(remValue));
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [ready]);

  const toggle = () => {
    const next = !collapsed;

    setCollapsed(next);
    document.documentElement.dataset.sidebar = next ? 'collapsed' : 'open';
    localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsed) return;

    const width = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--sl-sidebar-width'),
    );

    drag.current = {
      startX: event.clientX,
      startWidth: Number.isFinite(width) ? width : DEFAULT_WIDTH,
    };
    document.body.classList.add('ac-sidebar-resizing');
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-pressed={collapsed}
        data-sidebar-toggle=""
        onPress={toggle}
      >
        {collapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
      </Button>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-hidden={collapsed || undefined}
        data-sidebar-resizer=""
        onPointerDown={startResize}
      />
    </>
  );
}

export default SidebarControls;
