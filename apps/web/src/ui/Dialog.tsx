import { X } from "lucide-react";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

function closeOnBackdrop(e: MouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return;
  const r = e.currentTarget.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
}

export function Dialog({
  open,
  title,
  onClose,
  className = "m-auto w-[calc(100%-2rem)] max-w-lg rounded-4xl",
  dismissable = false,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  className?: string;
  dismissable?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current!;
    if (open) el.showModal();
    return () => el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={dismissable ? closeOnBackdrop : undefined}
      className={`border border-line bg-canvas p-6 text-fg backdrop:bg-scrim/80 ${className}`}
    >
      {open && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base/6 font-semibold text-fg-emphasis">{title}</h2>
            <button type="button" aria-label="Fechar" onClick={() => ref.current?.close()} className="rounded-lg p-1 text-fg hover:bg-interactive-hover hover:text-fg-emphasis">
              <X className="size-4" />
            </button>
          </div>
          {children}
        </>
      )}
    </dialog>
  );
}
