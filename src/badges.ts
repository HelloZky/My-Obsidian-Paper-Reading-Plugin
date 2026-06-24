export function ccfClass(value: string): string {
  if (value === "A") return "paper-vault-badge-a";
  if (value === "B") return "paper-vault-badge-b";
  if (value === "C") return "paper-vault-badge-c";
  return "";
}

export function quartileClass(value: string): string {
  return value === "Q1" || value === "1区" ? "paper-vault-badge-good" : "";
}
