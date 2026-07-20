import { None, Some, type Option } from '@virune/runtime';

export const args = (): readonly string[] => process.argv.slice(2);
export const cwd = (): string => process.cwd();
export const exitCode = (code: number): void => { process.exitCode = code; };
export const environment = (name: string): Option<string> => {
	const value = process.env[name];
	return value === undefined ? None : Some(value);
};
export const platform = (): string => process.platform;
export const architecture = (): string => process.arch;
