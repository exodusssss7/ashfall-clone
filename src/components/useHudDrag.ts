import {
  applyButtonScales,
  getButtonScale,
  getHudOffset,
  getHudScale,
  HUD_ELEMENT_ORIGINS,
  setButtonScale,
  setHudOffset,
  setHudScale,
  subscribeHudLayout,
  type HudElementId,
} from '../game/hudLayout';
import { useCallback, useEffect, useState } from 'react';
import type React from 'react';

/** Edge size of the corner grip that resizes instead of moving in Edit HUD mode. */
const RESIZE_GRIP_PX = 26;
/** Smaller grip for individual buttons. */
const BUTTON_GRIP_PX = 18;
/** Keep resized/moved controls inside the viewport with this breathing room. */
const VIEWPORT_MARGIN = 2;

function fitsViewport(rect: DOMRect): boolean {
  return (
    rect.left >= -VIEWPORT_MARGIN &&
    rect.top >= -VIEWPORT_MARGIN &&
    rect.right <= window.innerWidth + VIEWPORT_MARGIN &&
    rect.bottom <= window.innerHeight + VIEWPORT_MARGIN
  );
}

/**
 * Makes a HUD element repositionable and resizable in Edit HUD mode. In normal
 * play this only applies the saved offset/scale transform. While editing, a
 * native capture listener swallows pointer events before React ever sees them,
 * so buttons cannot fire and the element drags instead.
 *
 * Gestures while editing:
 * - drag the element body: moves the whole group;
 * - drag from the group's bottom-right corner: scales the whole group;
 * - drag from an individual button's bottom-right corner: scales just that
 *   button (data-btn-id), so every button can be sized on its own.
 *
 * Sizes and positions persist via the hudLayout store and are clamped so a
 * control can never be pushed or grown out of the viewport.
 */
export function useHudDrag(id: HudElementId, editing: boolean) {
  const buildTransform = () => {
    const { dx, dy } = getHudOffset(id);
    const scale = getHudScale(id);
    const parts: string[] = [];
    if (dx !== 0 || dy !== 0) parts.push(`translate(${dx}px, ${dy}px)`);
    if (scale !== 1) parts.push(`scale(${scale})`);
    return parts.length ? parts.join(' ') : undefined;
  };
  const [transform, setTransform] = useState<string | undefined>(buildTransform);

  useEffect(() => {
    return subscribeHudLayout(() => setTransform(buildTransform()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      if (!editing) {
        el.removeAttribute('data-hud-edit');
        return;
      }
      el.setAttribute('data-hud-edit', id);
      let start:
        | { mode: 'move'; x: number; y: number; dx: number; dy: number }
        | { mode: 'resize'; x: number; y: number; scale: number }
        | { mode: 'button-resize'; x: number; y: number; scale: number; btnId: string; btn: HTMLElement }
        | null = null;

      /** Pull the group's saved offset back until its rendered box fits the screen. */
      const clampMoveToViewport = () => {
        for (let i = 0; i < 8; i++) {
          const rect = el.getBoundingClientRect();
          if (fitsViewport(rect)) return;
          const o = getHudOffset(id);
          const adj = { dx: o.dx, dy: o.dy };
          if (rect.left < VIEWPORT_MARGIN) adj.dx += VIEWPORT_MARGIN - rect.left;
          if (rect.right > window.innerWidth - VIEWPORT_MARGIN)
            adj.dx -= rect.right - (window.innerWidth - VIEWPORT_MARGIN);
          if (rect.top < VIEWPORT_MARGIN) adj.dy += VIEWPORT_MARGIN - rect.top;
          if (rect.bottom > window.innerHeight - VIEWPORT_MARGIN)
            adj.dy -= rect.bottom - (window.innerHeight - VIEWPORT_MARGIN);
          if (adj.dx === o.dx && adj.dy === o.dy) return;
          setHudOffset(id, adj);
        }
      };

      const down = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Individual button resize wins: a press on a button's own corner grip
        // sizes that button only.
        const target = e.target as HTMLElement | null;
        const btn = target?.closest?.('[data-btn-id]') as HTMLElement | null;
        if (btn && el.contains(btn)) {
          const r = btn.getBoundingClientRect();
          if (e.clientX >= r.right - BUTTON_GRIP_PX && e.clientY >= r.bottom - BUTTON_GRIP_PX) {
            start = {
              mode: 'button-resize',
              x: e.clientX,
              y: e.clientY,
              scale: getButtonScale(btn.dataset.btnId!),
              btnId: btn.dataset.btnId!,
              btn,
            };
            try {
              el.setPointerCapture(e.pointerId);
            } catch {
              // synthetic pointer
            }
            return;
          }
        }
        const rect = el.getBoundingClientRect();
        const onGrip =
          e.clientX >= rect.right - RESIZE_GRIP_PX && e.clientY >= rect.bottom - RESIZE_GRIP_PX;
        if (onGrip) {
          start = { mode: 'resize', x: e.clientX, y: e.clientY, scale: getHudScale(id) };
        } else {
          const o = getHudOffset(id);
          start = { mode: 'move', x: e.clientX, y: e.clientY, dx: o.dx, dy: o.dy };
        }
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // synthetic pointer
        }
      };
      const move = (e: PointerEvent) => {
        if (!start) return;
        e.preventDefault();
        e.stopPropagation();
        if (start.mode === 'button-resize') {
          const delta = (e.clientX - start.x + (e.clientY - start.y)) / 240;
          const next = start.scale + delta;
          const prev = getButtonScale(start.btnId);
          setButtonScale(start.btnId, next);
          applyButtonScales(document);
          // Never let a button grow out of the screen.
          if (!fitsViewport(start.btn.getBoundingClientRect())) {
            setButtonScale(start.btnId, prev);
            applyButtonScales(document);
          }
          return;
        }
        if (start.mode === 'resize') {
          // Dragging the corner down/right grows the element, up/left shrinks it.
          const delta = (e.clientX - start.x + (e.clientY - start.y)) / 240;
          const prev = getHudScale(id);
          setHudScale(id, start.scale + delta);
          if (!fitsViewport(el.getBoundingClientRect())) {
            setHudScale(id, prev);
          }
          return;
        }
        setHudOffset(id, {
          dx: start.dx + (e.clientX - start.x),
          dy: start.dy + (e.clientY - start.y),
        });
        clampMoveToViewport();
      };
      const up = (e: PointerEvent) => {
        if (!start) return;
        e.preventDefault();
        e.stopPropagation();
        start = null;
      };
      const swallow = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };
      el.addEventListener('pointerdown', down, true);
      el.addEventListener('pointermove', move, true);
      el.addEventListener('pointerup', up, true);
      el.addEventListener('pointercancel', up, true);
      el.addEventListener('click', swallow, true);
      // cleanup runs when the ref detaches or `editing` flips
      return () => {
        el.removeAttribute('data-hud-edit');
        el.removeEventListener('pointerdown', down, true);
        el.removeEventListener('pointermove', move, true);
        el.removeEventListener('pointerup', up, true);
        el.removeEventListener('pointercancel', up, true);
        el.removeEventListener('click', swallow, true);
      };
    },
    [id, editing]
  );

  const style: React.CSSProperties = { transform, transformOrigin: HUD_ELEMENT_ORIGINS[id] ?? 'center' };
  return { ref, style, editing };
}
