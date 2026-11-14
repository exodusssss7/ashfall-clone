import { getHudOffset, setHudOffset, subscribeHudLayout, type HudElementId } from '../game/hudLayout';
import { useCallback, useEffect, useState } from 'react';
import type React from 'react';

/**
 * Makes a HUD element repositionable in Edit HUD mode. In normal play this only
 * applies the saved offset transform. While editing, a native capture listener
 * swallows pointer events before React ever sees them, so buttons cannot fire
 * and the element drags instead; offsets persist via the hudLayout store.
 */
export function useHudDrag(id: HudElementId, editing: boolean) {
  const [transform, setTransform] = useState<string | undefined>(() => {
    const { dx, dy } = getHudOffset(id);
    return dx !== 0 || dy !== 0 ? `translate(${dx}px, ${dy}px)` : undefined;
  });

  useEffect(() => {
    return subscribeHudLayout(() => {
      const { dx, dy } = getHudOffset(id);
      setTransform(dx !== 0 || dy !== 0 ? `translate(${dx}px, ${dy}px)` : undefined);
    });
  }, [id]);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      if (!editing) {
        el.removeAttribute('data-hud-edit');
        return;
      }
      el.setAttribute('data-hud-edit', id);
      let start: { x: number; y: number; dx: number; dy: number } | null = null;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const o = getHudOffset(id);
        start = { x: e.clientX, y: e.clientY, dx: o.dx, dy: o.dy };
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
        setHudOffset(id, {
          dx: start.dx + (e.clientX - start.x),
          dy: start.dy + (e.clientY - start.y),
        });
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

  const style: React.CSSProperties = { transform };
  return { ref, style, editing };
}
