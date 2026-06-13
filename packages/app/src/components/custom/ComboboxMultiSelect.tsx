import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "~/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/classUtils";

/** The shared shell for searchable multi-selects: removable chips above a
 *  popover trigger, a searchable option list with per-item check marks.
 *  Consumers (`AssigneeCombobox`, `TagCombobox`) supply the data + how to
 *  render a chip and an option; the selection is a controlled key array
 *  toggled via `onToggle`. `children` is injected into the list ABOVE the
 *  options group (e.g. a "Create" row); pass `search`/`onSearchChange` to drive
 *  a controlled input (needed for create-as-you-type). */
export function ComboboxMultiSelect<T>({
  selected,
  onToggle,
  options,
  getKey,
  getOptionValue,
  renderChip,
  renderOption,
  icon,
  label,
  searchPlaceholder,
  emptyText,
  search,
  onSearchChange,
  loop,
  children,
  className,
  chipsClassName,
}: {
  selected: string[];
  onToggle: (key: string) => void;
  options: T[];
  getKey: (item: T) => string;
  /** Search/match value for an option (defaults to its key). */
  getOptionValue?: (item: T) => string;
  /** Render one selected chip; call `remove` from its remove control. */
  renderChip: (key: string, remove: () => void) => React.ReactNode;
  /** Render an option's content (the check mark is appended automatically). */
  renderOption: (item: T) => React.ReactNode;
  icon: React.ReactNode;
  label: React.ReactNode;
  searchPlaceholder: string;
  /** Shown when the list is empty; omit to render no empty state. */
  emptyText?: React.ReactNode;
  search?: string;
  onSearchChange?: (value: string) => void;
  loop?: boolean;
  children?: React.ReactNode;
  className?: string;
  chipsClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {selected.length > 0 && (
        <div className={cn("flex flex-wrap gap-1.5", chipsClassName)}>
          {selected.map((key) => renderChip(key, () => onToggle(key)))}
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-8 justify-between font-normal text-muted-foreground"
          >
            <span className="flex items-center gap-2">
              {icon}
              {label}
            </span>
            <ChevronsUpDownIcon className="size-4 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-0"
          align="start"
        >
          <Command loop={loop}>
            <CommandInput
              value={search}
              onValueChange={onSearchChange}
              placeholder={searchPlaceholder}
              className="h-9"
            />
            <CommandList>
              {emptyText != null && <CommandEmpty>{emptyText}</CommandEmpty>}
              {children}
              {options.length > 0 && (
                <CommandGroup>
                  {options.map((item) => {
                    const key = getKey(item);
                    return (
                      <CommandItem
                        key={key}
                        value={getOptionValue?.(item) ?? key}
                        onSelect={() => onToggle(key)}
                        className="gap-2"
                      >
                        {renderOption(item)}
                        <CheckIcon
                          className={cn(
                            "ml-auto size-4 text-primary",
                            selected.includes(key) ? "opacity-100" : "opacity-0",
                          )}
                        />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
