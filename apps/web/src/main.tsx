import { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { Account } from "./pages/Account";
import { History } from "./pages/History";
import { Invite } from "./pages/Invite";
import { Login } from "./pages/Login";
import { NewSchedule } from "./pages/NewSchedule";
import { Schedules } from "./pages/Schedules";
import { AdminShell, AppShell, AuthShell } from "./shell/Shell";
import "./styles.css";
import { Loading } from "./ui/Text";

const pages: Record<string, () => React.JSX.Element> = {
  "/": Schedules,
  "/app": Schedules,
  "/app/novo": NewSchedule,
  "/app/historico": History,
  "/app/conta": Account,
};

const Admin = lazy(() => import("./admin/Admin"));

const root = createRoot(document.getElementById("root")!);

if (location.pathname.startsWith("/admin")) {
  root.render(
    <Suspense fallback={<AdminShell><Loading /></AdminShell>}>
      <Admin />
    </Suspense>,
  );
} else if (location.pathname === "/convite") {
  root.render(<AuthShell><Invite /></AuthShell>);
} else {
  const Page = pages[location.pathname];
  root.render(Page ? <AppShell><Page /></AppShell> : <AuthShell><Login /></AuthShell>);
}
