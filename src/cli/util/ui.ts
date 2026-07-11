import pc from "picocolors";

export const sym = {
  ok: pc.green("✔"),
  warn: pc.yellow("▲"),
  fail: pc.red("✖"),
  info: pc.cyan("ℹ"),
  bullet: pc.dim("•"),
  arrow: pc.dim("→"),
};

export function heading(text: string): void {
  // eslint-disable-next-line no-console
  console.log("\n" + pc.bold(pc.white(text)));
}

export function line(text = ""): void {
  // eslint-disable-next-line no-console
  console.log(text);
}

export function check(ok: boolean | "warn", label: string, detail?: string): void {
  const mark = ok === true ? sym.ok : ok === "warn" ? sym.warn : sym.fail;
  const tail = detail ? "  " + pc.dim(detail) : "";
  line(`  ${mark} ${label}${tail}`);
}

export function brand(): void {
  line(pc.bold(pc.green("Aster") + pc.cyan(" Agent Audit")) + pc.dim("  local-first audit & security for AI coding agents"));
}
