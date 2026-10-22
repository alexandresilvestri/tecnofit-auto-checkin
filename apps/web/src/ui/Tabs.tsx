import type { LucideIcon } from "lucide-react";

export type Tab = { href: string; label: string; icon: LucideIcon };

const path = location.pathname.replace(/\/$/, "");

export const activeTab = (items: Tab[]) =>
  items.filter((t) => path === t.href || path.startsWith(`${t.href}/`)).sort((a, b) => b.href.length - a.href.length)[0] ?? items[0];

export function Tabs({ items }: { items: Tab[] }) {
  const active = activeTab(items);
  return (
    <nav className="flex min-w-0 basis-full gap-1 overflow-x-auto sm:basis-auto">
      {items.map((t) => (
        <a
          key={t.href}
          href={t.href}
          aria-current={t === active ? "page" : undefined}
          className={`flex h-8 shrink-0 items-center gap-2 rounded-xl px-3 text-sm/5 font-semibold ${t === active ? "bg-interactive text-fg-emphasis" : "text-fg hover:text-fg-emphasis"}`}
        >
          <t.icon className="size-4" />
          {t.label}
        </a>
      ))}
    </nav>
  );
}
