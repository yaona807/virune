import { None, Some, type Option } from './core.js';

export const stringLength = (value: string): number => [...value].length;
export const stringTrim = (value: string): string => value.trim();
export const stringTrimStart = (value: string): string => value.trimStart();
export const stringTrimEnd = (value: string): string => value.trimEnd();
export const stringContains = (value: string, search: string): boolean => value.includes(search);
export const stringStartsWith = (value: string, search: string): boolean => value.startsWith(search);
export const stringEndsWith = (value: string, search: string): boolean => value.endsWith(search);
export const stringToLowerCase = (value: string): string => value.toLocaleLowerCase('und');
export const stringToUpperCase = (value: string): string => value.toLocaleUpperCase('und');
export const stringSplit = (value: string, separator: string): readonly string[] => value.split(separator);
export const stringJoin = (values: readonly string[], separator: string): string => values.join(separator);
export const stringReplace = (value: string, search: string, replacement: string): string => value.replaceAll(search, replacement);
export function stringSlice(value: string, start: number, end: Option<number>): string {
	const points = [...value];
	return points.slice(start, end.$tag === 'Some' ? end.$values[0] : undefined).join('');
}
export function stringAt(value: string, index: number): Option<string> {
	const points = [...value];
	return index >= 0 && index < points.length ? Some(points[index] as string) : None;
}
export const stringIsEmpty = (value: string): boolean => value.length === 0;
export const stringIsNotEmpty = (value: string): boolean => value.length > 0;

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });
export const stringGraphemes = (value: string): readonly string[] => [...graphemeSegmenter.segment(value)].map(item => item.segment);
export const stringGraphemeLength = (value: string): number => [...graphemeSegmenter.segment(value)].length;
export const stringNormalizeNfc = (value: string): string => value.normalize('NFC');
export const stringNormalizeNfd = (value: string): string => value.normalize('NFD');
export const stringNormalizeNfkc = (value: string): string => value.normalize('NFKC');
export const stringNormalizeNfkd = (value: string): string => value.normalize('NFKD');
