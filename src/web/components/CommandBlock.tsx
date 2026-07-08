import { ChevronRight, TriangleAlert } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * Renders a shell command as inert, read-only text. Aster Agent Console never
 * executes demo or incoming commands — this only displays them. Long commands
 * scroll horizontally instead of breaking the layout.
 */
export function CommandBlock({
  command,
  danger,
  label,
  className,
  wrap,
}: {
  command: string;
  danger?: boolean;
  label?: string;
  className?: string;
  /** Wrap long commands instead of scrolling sideways (narrow panels). */
  wrap?: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-md border",
        danger ? "border-danger/40" : "border-line",
        className
      )}
      style={
        danger
          ? { background: "color-mix(in srgb, var(--color-danger) 8%, var(--color-bg))" }
          : { background: "var(--color-bg)" }
      }
    >
      {label && (
        <div className="flex items-center gap-1.5 border-b border-line/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
          {danger && <TriangleAlert size={11} className="text-danger" />}
          {label}
        </div>
      )}
      <div className={cn("flex items-start gap-1.5 px-2.5 py-2", !wrap && "overflow-x-auto")}>
        <ChevronRight
          size={13}
          className={cn("mt-0.5 shrink-0", danger ? "text-danger" : "text-ink-3")}
        />
        <code
          className={cn(
            "font-mono text-[12px] leading-relaxed",
            wrap ? "min-w-0 whitespace-pre-wrap break-all" : "whitespace-pre",
            danger ? "text-[#fda4af]" : "text-ink-2"
          )}
        >
          {command}
        </code>
      </div>
    </div>
  );
}
