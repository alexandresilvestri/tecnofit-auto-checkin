import { CalendarCheck, History, KeyRound, ListChecks, Plus, ScrollText, User, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Tabs, type Tab } from "../ui/Tabs";
import { ThemeToggle } from "../ui/ThemeToggle";

function Brand({ title = "Auto check-in by GasparzZ :)", subtitle }: { title?: string; subtitle?: string }) {
  return (
    <a href="/app" className="flex items-center gap-3">
      <img src="/favicon.png" alt="" className="size-8" />
      <span className="flex flex-col">
        <span className="font-display text-base/5 font-medium text-fg-emphasis">{title}</span>
        {subtitle && <span className="hidden text-xs/4 text-fg-muted xl:block">{subtitle}</span>}
      </span>
    </a>
  );
}

function Header({ tabs, right, brand = <Brand /> }: { tabs: Tab[]; right?: ReactNode; brand?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/60 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 sm:flex-nowrap">
        {brand}
        <span className="ml-auto flex items-center gap-1 sm:order-last">
          <ThemeToggle />
          {right}
        </span>
        <Tabs items={tabs} />
      </div>
    </header>
  );
}

const APP: Tab[] = [
  { href: "/app", label: "Agendamentos", icon: CalendarCheck },
  { href: "/app/novo", label: "Novo", icon: Plus },
  { href: "/app/historico", label: "Histórico", icon: History },
  { href: "/app/conta", label: "Conta", icon: User },
];

const ADMIN: Tab[] = [
  { href: "/admin/convites", label: "Convites", icon: KeyRound },
  { href: "/admin/usuarios", label: "Usuários", icon: Users },
  { href: "/admin/execucoes", label: "Execuções", icon: ListChecks },
  { href: "/admin/auditoria", label: "Auditoria", icon: ScrollText },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        tabs={APP}
        brand={<Brand title="Agende seu check-in" subtitle="Selecione data e hora, confirme o agendamento e pronto: seu check-in está garantido." />}
      />
      <main className="mx-auto w-full max-w-text flex-1 px-6 py-6">{children}</main>
      <footer className="mx-auto w-full max-w-text px-6 py-8 text-xs text-fg-muted">Desenvolvido por Alexandre Silvestri</footer>
    </div>
  );
}

export function AdminShell({ right, children }: { right?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Header tabs={ADMIN} right={right} />
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </>
  );
}

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex max-w-[400px] flex-col gap-8 px-6 pt-16 pb-12">
      <div className="flex items-center justify-between">
        <Brand />
        <ThemeToggle />
      </div>
      {children}
    </main>
  );
}
