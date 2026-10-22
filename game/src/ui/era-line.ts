/**
 * A map's own wording for the place screens' lines that are laid out in pieces (lines split over elements, which the
 * map's text pass cannot see whole): 激情歲月 sets it (ui/jq-theme.ts), every other map has none (the text as it is).
 */
let filter: ((s: string) => string) | null = null;
export const eraLine = (s: string): string => (filter ? filter(s) : s);
export function setEraLine(f: ((s: string) => string) | null) { filter = f; }
/** Whether the current map has its own wording (激情歲月): screens may then add the era's headlines. */
export const eraOn = (): boolean => filter !== null;
