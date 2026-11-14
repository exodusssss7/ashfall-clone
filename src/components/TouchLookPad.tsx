import React, { useRef } from 'react';

interface TouchLookPadProps {
  onLookDelta: (dx: number, dy: number) => void;
}

/**
 * Full right-side touch drag surface for First-Person camera aiming (yaw + pitch).
 * Rendered beneath HUD/action buttons (z-[5]) so tapping HUD slots or SLASH/FIRE
 * buttons never steals look input, while dragging anywhere on the open right screen
 * smoothly rotates the first-person view.
 */
export const TouchLookPad: React.FC<TouchLookPadProps> = ({ onLookDelta }) => {
  const activePointerRef = useRef<number | null>(null);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  const releasePointer = (target: HTMLDivElement, pointerId: number) => {
    if (activePointerRef.current !== pointerId) return;
    activePointerRef.current = null;
    lastPosRef.current = null;
    try {
      if (target.hasPointerCapture?.(pointerId)) {
        target.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore synthetic events
    }
  };

  return (
    <div
      data-testid="touch-look-pad"
      role="application"
      aria-label="First-person camera look zone — drag to aim"
      className="touch-look-pad fixed top-0 bottom-0 right-0 left-[29vw] z-[5] pointer-events-auto select-none"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.preventDefault();
        if (activePointerRef.current !== null) return;
        activePointerRef.current = e.pointerId;
        lastPosRef.current = { x: e.clientX, y: e.clientY };
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          // Synthetic PointerEvents may not register an active pointer id
        }
      }}
      onPointerMove={(e) => {
        if (activePointerRef.current !== e.pointerId || !lastPosRef.current) return;
        e.preventDefault();
        const dx = e.clientX - lastPosRef.current.x;
        const dy = e.clientY - lastPosRef.current.y;
        lastPosRef.current = { x: e.clientX, y: e.clientY };
        if (dx !== 0 || dy !== 0) {
          onLookDelta(dx, dy);
        }
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        releasePointer(e.currentTarget, e.pointerId);
      }}
      onPointerCancel={(e) => {
        releasePointer(e.currentTarget, e.pointerId);
      }}
      onLostPointerCapture={(e) => {
        releasePointer(e.currentTarget, e.pointerId);
      }}
    />
  );
};
