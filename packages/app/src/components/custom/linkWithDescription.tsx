import { cn } from "~/lib/classUtils";
import { Link } from "@tanstack/react-router";
import { HTMLAttributes } from "react";

export function LinkWithDescription({
  description,
  href,
  preserveSearch = false,
  children,
  ...props
}: React.PropsWithChildren<{
  description: string;
  href: string;
  /** Carry the current `?query` to the target (the login <-> sign-up links
   *  keep an in-flight OAuth authorize query alive this way). */
  preserveSearch?: boolean;
}> &
  HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cn("text-sm", props.className)}>
      {description}{" "}
      <Link
        to={href}
        search={preserveSearch ? true : undefined}
        className="text-link underline underline-offset-2"
      >
        {children}
      </Link>
    </div>
  );
}
