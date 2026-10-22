import { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { Account } from "./pages/Account";
import { History } from "./pages/History";
import { Invite } from "./pages/Invite";
import { Login } from "./pages/Login";
import { NewSchedule } from "./pages/NewSchedule";
import { Schedules } from "./pages/Schedules";
import "./styles.css";

const pages: Record<string, () => React.JSX.Element> = {
  "/": Schedules,
  "/convite": Invite,
  "/app": Schedules,
  "/app/novo": NewSchedule,
  "/app/historico": History,
  "/app/conta": Account,
};

const Admin = lazy(() => import("./admin/Admin"));

const root = createRoot(document.getElementById("root")!);

if (location.pathname.startsWith("/admin")) {
  root.render(
    <Suspense fallback={<main className="card"><p>Carregando...</p></main>}>
      <Admin />
    </Suspense>,
  );
} else {
  const Page = pages[location.pathname] ?? Login;
  root.render(
    <main className="card">
      <Page />
    </main>,
  );
}
