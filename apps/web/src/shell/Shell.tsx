import { CalendarCheck, History, KeyRound, ListChecks, Plus, ScrollText, User, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Tabs, type Tab } from "../ui/Tabs";

const Brand = () => <span className="font-display text-base font-medium text-fg-emphasis">Check-in</span>;

function Header({ tabs, right }: { tabs: Tab[]; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-base/60 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 sm:h-[58px] sm:flex-nowrap sm:py-0">
        <Brand />
        <span className="ml-auto sm:order-last">{right}</span>
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
    <>
      <Header tabs={APP} />
      <main className="mx-auto max-w-text px-6 py-6">{children}</main>
    </>
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
      <Brand />
      {children}
    </main>
  );
}
