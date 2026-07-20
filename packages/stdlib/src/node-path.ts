import * as path from 'node:path';

export const join = (...parts: readonly string[]): string => path.join(...parts);
export const resolve = (...parts: readonly string[]): string => path.resolve(...parts);
export const dirname = (value: string): string => path.dirname(value);
export const basename = (value: string): string => path.basename(value);
export const extname = (value: string): string => path.extname(value);
export const normalize = (value: string): string => path.normalize(value);
export const relative = (from: string, to: string): string => path.relative(from, to);
export const isAbsolute = (value: string): boolean => path.isAbsolute(value);

export const joinParts = (parts: readonly string[]): string => path.join(...parts);
export const resolveParts = (parts: readonly string[]): string => path.resolve(...parts);
