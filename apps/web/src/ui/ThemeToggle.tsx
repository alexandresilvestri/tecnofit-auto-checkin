import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { currentTheme, setTheme } from "../theme";
import { Button } from "./Button";

export function ThemeToggle({ label = false }: { label?: boolean }) {
  const [theme, set] = useState(currentTheme);
  const light = theme === "light";
  const Icon = light ? Moon : Sun;
  const name = light ? "Tema escuro" : "Tema claro";
  return (
    <Button
      variant="ghost"
      size={label ? "lg" : "md"}
      className={label ? "w-full justify-start gap-3 font-semibold" : "px-2"}
      onClick={() => set(setTheme(light ? "dark" : "light"))}
    >
      <Icon className="size-4" />
      <span className={label ? undefined : "sr-only"}>{name}</span>
    </Button>
  );
}
