/** Time-of-day greeting for the top bar. */
export function greeting(name: string, date = new Date()): string {
  const h = date.getHours();
  const part =
    h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}.`;
}
