import { createRoot } from "react-dom/client";
import { Home } from "./pages/Home";
import { Invite } from "./pages/Invite";
import { Login } from "./pages/Login";
import "./styles.css";

const pages: Record<string, () => React.JSX.Element> = {
  "/convite": Invite,
  "/app": Home,
};

const Page = pages[location.pathname] ?? Login;

createRoot(document.getElementById("root")!).render(
  <main className="card">
    <Page />
  </main>,
);
