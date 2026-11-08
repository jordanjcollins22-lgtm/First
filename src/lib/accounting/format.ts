export function money(n: number, { cents = true }: { cents?: boolean } = {}) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export function percent(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits).replace(/\.0+$/, "")}%`;
}
