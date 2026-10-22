import type { ComponentProps } from "react";

const VARIANT = {
  primary: "bg-accent font-semibold text-fg-on-accent hover:bg-accent-hover",
  secondary: "border border-line-interactive bg-interactive font-medium text-fg hover:bg-interactive-hover",
  ghost: "font-medium text-fg hover:bg-interactive-hover hover:text-fg-emphasis",
  danger: "font-medium text-danger hover:bg-interactive-hover",
};

const SIZE = { md: "h-8", lg: "h-10" };

type Style = { variant?: keyof typeof VARIANT; size?: keyof typeof SIZE; className?: string };

const classes = ({ variant = "primary", size = "md", className = "" }: Style) =>
  `inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 text-sm/5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-70 ${VARIANT[variant]} ${SIZE[size]} ${className}`;

export function Button({ variant, size, className, ...rest }: Style & ComponentProps<"button">) {
  return <button type="button" {...rest} className={classes({ variant, size, className })} />;
}

export function LinkButton({ variant, size, className, ...rest }: Style & ComponentProps<"a">) {
  return <a {...rest} className={classes({ variant, size, className })} />;
}
