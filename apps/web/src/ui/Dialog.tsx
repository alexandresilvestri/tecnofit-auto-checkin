import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export function Dialog({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
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
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-4xl border border-line bg-base p-6 text-fg backdrop:bg-scrim/80"
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
