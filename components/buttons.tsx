"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Icon, type IconName } from "@/components/icons";

export function SubmitButton({
  children,
  pendingText,
  variant,
  icon,
  size,
  block,
  name,
  value,
  confirmText,
  disabled,
  formAction
}: {
  children: ReactNode;
  pendingText?: string;
  variant?: "primary" | "ghost" | "danger" | "whatsapp";
  icon?: IconName;
  size?: "small" | "lg";
  block?: boolean;
  name?: string;
  value?: string;
  confirmText?: string;
  disabled?: boolean;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      disabled={pending || disabled}
      className={`btn ${variant ?? ""} ${size ?? ""} ${block ? "block" : ""}`}
      onClick={(event) => {
        if (confirmText && !window.confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      {icon ? <Icon name={icon} size={size === "small" ? 15 : 17} /> : null}
      {pending ? pendingText ?? "Working…" : children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy", onCopied }: { text: string; label?: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const area = document.createElement("textarea");
          area.value = text;
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        setCopied(true);
        onCopied?.();
        window.setTimeout(() => setCopied(false), 1800);
      }}
    >
      <Icon name={copied ? "check" : "copy"} size={15} />
      {copied ? "Copied" : label}
    </button>
  );
}
