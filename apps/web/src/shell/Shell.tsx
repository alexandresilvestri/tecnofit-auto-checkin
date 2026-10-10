import { CalendarCheck, History, KeyRound, ListChecks, Menu as MenuIcon, Plus, ScrollText, User, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, LinkButton } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Tabs, activeTab, type Tab } from "../ui/Tabs";
import { ThemeToggle } from "../ui/ThemeToggle";

function Brand({ title = "Auto check-in by Alexandre", subtitle }: { title?: string; subtitle?: string }) {
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

function Header({ brand = <Brand />, children }: { brand?: ReactNode; children: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/60 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 sm:flex-nowrap">
        {brand}
        {children}
      </div>
    </header>
  );
}

function Menu({ items }: { items: Tab[] }) {
  const [open, setOpen] = useState(false);
  const active = activeTab(items);
  return (
    <>
      <Button variant="ghost" className="ml-auto px-2" aria-label="Menu" onClick={() => setOpen(true)}>
        <MenuIcon className="size-4" />
      </Button>
      <Dialog
        open={open}
        title="Menu"
        onClose={() => setOpen(false)}
        dismissable
        className="ml-auto h-dvh max-h-none w-72 max-w-[calc(100%-3rem)] flex-col rounded-l-4xl transition-transform duration-200 ease-out open:flex starting:translate-x-full motion-reduce:transition-none"
      >
        <nav className="flex flex-col gap-1">
          {items.map((t) => (
            <LinkButton
              key={t.href}
              href={t.href}
              variant="ghost"
              size="lg"
              aria-current={t === active ? "page" : undefined}
              className={`justify-start gap-3 font-semibold ${t === active ? "bg-interactive text-fg-emphasis" : ""}`}
            >
              <t.icon className="size-4" />
              {t.label}
            </LinkButton>
          ))}
        </nav>
        <div className="mt-auto border-t border-line pt-4">
          <ThemeToggle label />
        </div>
      </Dialog>
    </>
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
      <Header brand={<Brand title="Agende seu check-in" subtitle="Selecione data e hora, confirme o agendamento e pronto: seu check-in está garantido." />}>
        <Menu items={APP} />
      </Header>
      <main className="mx-auto w-full max-w-text flex-1 px-6 py-6">{children}</main>
      <footer className="mx-auto w-full max-w-text px-6 py-8 text-xs text-fg-muted">Desenvolvido por Alexandre Silvestri</footer>
    </div>
  );
}

export function AdminShell({ right, children }: { right?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Header>
        <span className="ml-auto flex items-center gap-1 sm:order-last">
          <ThemeToggle />
          {right}
        </span>
        <Tabs items={ADMIN} />
      </Header>
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </>
  );
}

export function AuthShell({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col gap-8 px-6 pt-16 pb-12">
        <div className="flex items-center gap-3">
          <img src="/favicon.png" alt="" className="size-8" />
          {title && <h1 className="font-display text-[28px]/[34px] font-medium text-fg-emphasis">{title}</h1>}
        </div>
        {children}
      </main>
      <footer className="mx-auto w-full max-w-[400px] px-6 py-8 text-xs text-fg-muted">Desenvolvido por Alexandre Silvestri</footer>
    </div>
  );
}
