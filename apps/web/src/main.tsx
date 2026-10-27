import "./theme";
import { scrub } from "@checkin/core/observability/scrub";
import * as Sentry from "@sentry/react";
import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Account } from "./pages/Account";
import { History } from "./pages/History";
import { Invite } from "./pages/Invite";
import { Login } from "./pages/Login";
import { NewSchedule } from "./pages/NewSchedule";
import { Schedules } from "./pages/Schedules";
import { AdminShell, AppShell, AuthShell } from "./shell/Shell";
import "./styles.css";
import { Button } from "./ui/Button";
import { EmptyState } from "./ui/EmptyState";
import { Loading } from "./ui/Text";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  beforeSend: scrub,
  integrations: (defaults) => defaults.filter((i) => i.name !== "Breadcrumbs" && i.name !== "BrowserSession"),
});

const pages: Record<string, () => React.JSX.Element> = {
  "/": Schedules,
  "/app": Schedules,
  "/app/novo": NewSchedule,
  "/app/historico": History,
  "/app/conta": Account,
};

const Admin = lazy(() => import("./admin/Admin"));

const root = createRoot(document.getElementById("root")!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
});

const crashed = (
  <AuthShell>
    <EmptyState title="Algo deu errado" text="Recarregue a página para tentar de novo.">
      <Button onClick={() => location.reload()}>Recarregar</Button>
    </EmptyState>
  </AuthShell>
);

const render = (node: ReactNode) => root.render(<Sentry.ErrorBoundary fallback={crashed}>{node}</Sentry.ErrorBoundary>);

if (location.pathname.startsWith("/admin")) {
  render(
    <Suspense fallback={<AdminShell><Loading /></AdminShell>}>
      <Admin />
    </Suspense>,
  );
} else if (location.pathname === "/convite") {
  render(<AuthShell><Invite /></AuthShell>);
} else {
  const Page = pages[location.pathname];
  render(Page ? <AppShell><Page /></AppShell> : <AuthShell title="Check-in automático"><Login /></AuthShell>);
}
