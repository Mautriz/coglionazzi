/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createFormHook,
  createFormHookContexts,
  ValidationError,
} from "@tanstack/react-form";
import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "~/lib/classUtils";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();

/** App-wide TanStack Form hook. Fields are pre-bound components used as
 *  `<form.AppField name="email">{(f) => <f.TextField label="Email" />}</form.AppField>`;
 *  grow this with new field kinds (selects, switches, …) as features need them. */
export const { useAppForm, withFieldGroup } = createFormHook({
  fieldContext,
  formContext,
  formComponents: {
    SubscribeButton,
  },
  fieldComponents: {
    TextField,
  },
});

function TextField({
  label,
  className,
  disabled,
  placeholder,
  type = "text",
}: {
  label: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  type?: "text" | "email" | "password";
}) {
  const {
    name,
    state: {
      value,
      meta: { errors },
    },
    handleBlur,
    handleChange,
  } = useFieldContext<string>();

  const [showPassword, setShowPassword] = useState(false);
  const inputType =
    type === "password" ? (showPassword ? "text" : "password") : type;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={name}>{label}</Label>
      <div className="relative">
        <Input
          disabled={disabled}
          value={value ?? ""}
          onChange={(e) => handleChange(e.currentTarget.value)}
          placeholder={placeholder}
          onBlur={handleBlur}
          name={name}
          id={name}
          type={inputType}
          className={type === "password" ? "pr-9 w-full" : "w-full"}
        />
        {type === "password" && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>
      <FieldErrors errors={errors} />
    </div>
  );
}

function SubscribeButton({
  children,
}: {
  children: (canSubmit: boolean) => React.ReactNode;
}) {
  const form = useFormContext();
  return (
    <form.Subscribe
      selector={(state) => state.canSubmit && !state.isSubmitting}
    >
      {(v) => children(v)}
    </form.Subscribe>
  );
}

export const FieldErrors = ({
  errors,
}: {
  errors?: (string | ValidationError)[];
}) => {
  return errors?.length ? (
    <p className="text-destructive text-xs leading-[100%]">
      {(errors[0] as any)?.message || errors[0]}
    </p>
  ) : null;
};
