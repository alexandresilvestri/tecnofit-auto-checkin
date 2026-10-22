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

const Page = pages[location.pathname] ?? Login;

createRoot(document.getElementById("root")!).render(
  <main className="card">
    <Page />
  </main>,
);
