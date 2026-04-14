"use client";

import { useEffect, useRef } from "react";

export default function AutoResizeTextarea({
  value,
  onChange,
  className = "",
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={1}
      className={`w-full resize-none overflow-hidden bg-transparent focus:outline-none ${className}`}
    />
  );
}
