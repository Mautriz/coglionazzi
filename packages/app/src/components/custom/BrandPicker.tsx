import { CheckIcon, PaletteIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/classUtils";
import { BRANDS, setBrand, useBrand } from "~/lib/theme";

/** Topbar swatch picker for the brand "skin" (accent/surface hue). Layers on
 *  top of the light/dark toggle — see lib/theme.ts. */
export function BrandPicker() {
  const brand = useBrand();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Pick a color theme">
          <PaletteIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <p className="text-muted-foreground px-2 pt-1 pb-2 text-xs font-medium">
          Color theme
        </p>
        <div className="flex flex-col gap-0.5">
          {BRANDS.map((b) => {
            const active = b.id === brand;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  setBrand(b.id);
                  setOpen(false);
                }}
                className={cn(
                  "hover:bg-accent flex items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                  active && "bg-accent",
                )}
              >
                <span
                  className="border-border1 size-5 shrink-0 rounded-full border"
                  style={{ backgroundImage: b.swatch }}
                />
                <span className="flex-1">{b.label}</span>
                {active && <CheckIcon className="text-primary size-4" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
