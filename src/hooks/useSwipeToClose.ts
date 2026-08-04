import { useEffect, useRef, useState, TouchEvent as ReactTouchEvent } from 'react';

// Left-edge swipe right, mirroring the OS back gesture — shared by every full-screen
// overlay that slides in over another screen (Réglages over Séance, Calendrier's day
// view over the month view). Ignored unless it starts within the edge zone (a swipe
// starting mid-screen is more likely scrolling a horizontal row) and is mostly horizontal
// (not a vertical page scroll). The panel follows the finger live (dragX, no transition)
// while dragging, then either snaps back or finishes sliding out (transition re-enabled)
// so the close reads as one continuous gesture instead of the panel just vanishing.
//
// `canClose` lets a caller veto the close at the last moment (e.g. Réglages: unsaved
// changes) — return false to snap back instead, and use `onBlocked` to surface its own
// confirmation UI at that point.
interface UseSwipeToCloseOptions {
  onClose: () => void;
  closeDelayMs?: number;
  canClose?: () => boolean;
  onBlocked?: () => void;
}

export function useSwipeToClose({ onClose, closeDelayMs = 220, canClose, onBlocked }: UseSwipeToCloseOptions) {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    draggingRef.current = false;
  };

  // Native (non-passive) listener rather than React's onTouchMove: React attaches touch
  // listeners as passive by default, so e.preventDefault() inside a JSX onTouchMove handler
  // is silently ignored (and warns in the console) — it would never actually stop the page
  // from also scrolling vertically underneath the horizontal drag.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      const start = touchStartRef.current;
      if (!start || start.x > 32) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!draggingRef.current) {
        if (dx > 10 && Math.abs(dx) > Math.abs(dy) * 2) {
          draggingRef.current = true;
          setDragActive(true);
        } else {
          return;
        }
      }
      e.preventDefault();
      setDragX(Math.max(0, dx));
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, []);

  const handleTouchEnd = (e: ReactTouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    setDragActive(false);
    if (!wasDragging) { setDragX(0); return; }
    const t = e.changedTouches[0];
    const dx = start ? t.clientX - start.x : 0;
    if (dx > 80) {
      if (canClose && !canClose()) {
        setDragX(0);
        onBlocked?.();
        return;
      }
      setClosing(true);
      setDragX(window.innerWidth);
    } else {
      setDragX(0);
    }
  };

  // Let the slide-out finish before unmounting (onClose), so it reads as a close
  // transition instead of a disappearance. onClose is read via a ref rather than a direct
  // effect dependency: it's a fresh inline function on every parent render, and depending
  // on it directly would restart the timer on any parent re-render while closing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => onCloseRef.current(), closeDelayMs);
    return () => clearTimeout(timer);
  }, [closing, closeDelayMs]);

  return {
    panelRef,
    handleTouchStart,
    handleTouchEnd,
    panelStyle: {
      transform: dragX ? `translateX(${dragX}px)` : undefined,
      transition: dragActive ? 'none' : 'transform 0.22s ease-out',
      touchAction: 'pan-y' as const,
    },
  };
}
