/**
 * A map's own wording for the place screens' lines that are laid out in pieces (lines split over elements, which the
 * map's text pass cannot see whole): 激情歲月 sets it (ui/jq-theme.ts), every other map has none (the text as it is).
 */
let filter: ((s: string) => string) | null = null, headlines = false;
export const eraLine = (s: string): string => (filter ? filter(s) : s);
/** `jqHeadlines`: 激情歲月's own headlines and plaques too (長安's words come without them). */
export function setEraLine(f: ((s: string) => string) | null, jqHeadlines = true) { filter = f; headlines = !!f && jqHeadlines; }
/** Whether the current map is 激情歲月 with its wording: screens may then add the era's headlines. */
export const eraOn = (): boolean => headlines;
