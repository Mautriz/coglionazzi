import { cn } from "~/lib/classUtils";
import { Link } from "@tanstack/react-router";
import { HTMLAttributes } from "react";

export function LinkWithDescription({
  description,
  href,
  children,
  ...props
}: React.PropsWithChildren<{ description: string; href: string }> &
  HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn("text-sm", props.className)}>
      {description}{" "}
      <Link to={href} className="text-link underline underline-offset-2">
        {children}
      </Link>
    </div>
  );
}
