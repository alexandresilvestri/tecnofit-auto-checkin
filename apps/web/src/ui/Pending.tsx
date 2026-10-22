const PULSE = "M2 20h40l5-9 7 21 8-28 6 16h50";

export function Pending({ title }: { title: string }) {
  return (
    <div role="status" className="fixed inset-0 z-50 grid place-items-center bg-scrim/80 p-6">
      <div className="flex w-full max-w-xs flex-col items-center gap-2 rounded-4xl border border-line bg-canvas p-8 text-center">
        <svg viewBox="0 0 120 36" className="mb-4 w-32" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={PULSE} className="stroke-line" />
          <path d={PULSE} pathLength={1} strokeDasharray="1" className="animate-trace stroke-fg-emphasis motion-reduce:animate-none" />
        </svg>
        <p className="font-display text-base/6 font-semibold text-fg-emphasis">{title}</p>
        <p className="text-sm/5 text-fg">Aguarde enquanto a Tecnofit responde. Pode levar alguns segundos.</p>
      </div>
    </div>
  );
}
