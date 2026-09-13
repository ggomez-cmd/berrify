import { Minus, Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type TouchEvent, type WheelEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../components/ui/button";

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function InvoicePhotoLightbox({
  open,
  src,
  onClose,
}: {
  open: boolean;
  src: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });
  const pinchDistance = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setZoom(MIN_ZOOM);
      setPan({ x: 0, y: 0 });
      dragging.current = false;
      pinchDistance.current = null;
      return;
    }
    shellRef.current?.focus();
  }, [open, src]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const stopReviewDismiss = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
  };

  const applyZoom = (next: number) => {
    const clamped = clampZoom(next);
    setZoom(clamped);
    if (clamped <= MIN_ZOOM) setPan({ x: 0, y: 0 });
  };

  const onPointerDown = (event: PointerEvent<HTMLImageElement>) => {
    if (zoom <= MIN_ZOOM) return;
    dragging.current = true;
    lastPointer.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLImageElement>) => {
    if (!dragging.current) return;
    const dx = event.clientX - lastPointer.current.x;
    const dy = event.clientY - lastPointer.current.y;
    lastPointer.current = { x: event.clientX, y: event.clientY };
    setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
  };

  const endDrag = () => {
    dragging.current = false;
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    applyZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  };

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    pinchDistance.current = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || pinchDistance.current == null) return;
    event.preventDefault();
    const [a, b] = [event.touches[0], event.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const delta = distance - pinchDistance.current;
    pinchDistance.current = distance;
    applyZoom(zoom + delta / 200);
  };

  const onTouchEnd = () => {
    pinchDistance.current = null;
  };

  return createPortal(
    <div
      ref={shellRef}
      role="dialog"
      aria-modal="true"
      aria-label="Invoice photo"
      tabIndex={-1}
      className="fixed inset-0 z-[80] outline-none"
      onClick={stopReviewDismiss}
      onKeyDown={stopReviewDismiss}
      onPointerDown={stopReviewDismiss}
    >
      <button
        type="button"
        className="absolute inset-0 bg-navy/40"
        aria-label="Close photo overlay"
        onClick={onClose}
      />
      <div className="absolute right-4 top-4 z-10 flex gap-2">
        <Button
          variant="ghost"
          className="bg-white px-2"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => applyZoom(zoom - ZOOM_STEP)}
        >
          <Minus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          className="bg-white px-2"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => applyZoom(zoom + ZOOM_STEP)}
        >
          <Plus className="size-4" />
        </Button>
        <Button variant="ghost" className="bg-white px-2" aria-label="Close photo" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>
      <div
        className="pointer-events-none relative flex h-full w-full items-center justify-center overflow-hidden p-6"
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          src={src}
          alt="Invoice photo"
          draggable={false}
          className="pointer-events-auto max-h-full max-w-full select-none object-contain"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > MIN_ZOOM ? "grab" : "zoom-in",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
    </div>,
    document.body,
  );
}
