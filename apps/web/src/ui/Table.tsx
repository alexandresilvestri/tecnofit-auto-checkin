import type { ReactNode } from "react";

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm/5 text-fg">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={i}
                className="h-8 border-y border-line-interactive bg-interactive px-3 text-left text-xs/4 font-semibold whitespace-nowrap text-fg first:rounded-l-xl first:border-l last:rounded-r-xl last:border-r"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-line-subtle [&_td]:p-3 [&_td]:align-middle [&_td]:whitespace-nowrap [&_td]:tabular-nums">{children}</tbody>
      </table>
    </div>
  );
}
