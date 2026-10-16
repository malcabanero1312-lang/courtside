"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

const STORAGE_KEY = "courtside.hiddenColumns";

export function ColumnToggle({ columns }: { columns: { key: string; label: string }[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
      if (Array.isArray(saved)) setHidden(saved.filter((v) => typeof v === "string"));
    } catch {
      setHidden([]);
    }
  }, []);

  const toggle = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      return;
    }
  };

  const css = hidden.map((key) => `[data-col="${key}"]{display:none}`).join("");

  return (
    <div className="picker">
      <style>{css}</style>
      <button type="button" className="btn small" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon name="columns" size={15} /> Columns
      </button>
      {open ? (
        <div className="picker-menu" style={{ left: "auto", right: 0, width: 200 }}>
          {columns.map((column) => (
            <label key={column.key} className="picker-option check">
              <input type="checkbox" checked={!hidden.includes(column.key)} onChange={() => toggle(column.key)} />
              {column.label}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SelectAll({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      onChange={(event) => {
        const form = document.getElementById(formId);
        form?.querySelectorAll<HTMLInputElement>('input[name="ids"]').forEach((box) => {
          box.checked = event.target.checked;
        });
        form?.dispatchEvent(new Event("change", { bubbles: true }));
      }}
    />
  );
}

export function SelectedCount({ formId }: { formId: string }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const form = document.getElementById(formId);
    if (!form) return;
    const update = () => setCount(form.querySelectorAll('input[name="ids"]:checked').length);
    form.addEventListener("change", update);
    update();
    return () => form.removeEventListener("change", update);
  }, [formId]);
  return <span className="small muted">{count > 0 ? `${count} selected` : "Select rows to update several at once"}</span>;
}
