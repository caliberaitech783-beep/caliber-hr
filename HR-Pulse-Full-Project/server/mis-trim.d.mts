export function trimMisReport<T extends Record<string, unknown>>(report: T, site: string, from: string, to: string): T & {misSites: string[]};
