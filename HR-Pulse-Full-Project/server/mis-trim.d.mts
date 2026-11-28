export function trimMisReport<T extends Record<string, unknown>>(report: T, site: string, from: string, to: string): T & {misSites: string[]; misSiteDays: Record<string, string[]>};
export function weekOf(day: string, first: string): {from: string; to: string};
export function dayOfWeekReport<T extends Record<string, unknown>>(week: T, day: string): Omit<T, 'misSiteDays' | 'run'> & {misSites: string[]};
