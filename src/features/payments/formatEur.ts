/** EUR display for the Payments page: integers stay integer, fractionals show 2 decimals. */
export function formatEur(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
