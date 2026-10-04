import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { currentTheme, setTheme } from "../theme";
import { Button } from "./Button";

export function ThemeToggle() {
  const [theme, set] = useState(currentTheme);
  const light = theme === "light";
  const Icon = light ? Moon : Sun;
  return (
    <Button variant="ghost" className="px-2" aria-label={light ? "Tema escuro" : "Tema claro"} onClick={() => set(setTheme(light ? "dark" : "light"))}>
      <Icon className="size-4" />
    </Button>
  );
}
