export function sameSite(hrSite: string, misSite: string): boolean;
export function exactSite(hrSite: string, misSite: string): boolean;
export function siteMatcher(hrSite: string, known?: Iterable<string>): (misSite: string) => boolean;
