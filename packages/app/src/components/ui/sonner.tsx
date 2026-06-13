import * as React from "react";
import { Toaster as Sonner, ToasterProps } from "sonner";
import { useTheme } from "~/lib/theme";

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      toastOptions={{
        descriptionClassName: "!text-muted-foreground",
      }}
      style={
        {
          "--normal-bg": "var(--color-popover)",
          "--normal-text": "var(--color-popover-foreground)",
          "--normal-border": "var(--color-border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
