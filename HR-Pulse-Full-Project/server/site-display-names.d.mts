export declare const SITE_ALIASES: Record<string, string[]>;
export declare function siteKey(value: unknown): string;
export declare function siteDisplayName(name: string, code?: string): string;
export declare function siteNameKeys(name: string): string[];
export declare function siteNameMatch(nameParam: string, keysParam: string): string;
export declare function exactNameFirst(nameParam: string): string;
