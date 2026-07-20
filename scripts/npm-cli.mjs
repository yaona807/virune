import { execFileSync, spawnSync } from 'node:child_process';

export function execNpmSync(argumentsList, options) {
	const invocation = npmInvocation(argumentsList);
	return execFileSync(invocation.command, invocation.argumentsList, options);
}

export function spawnNpmSync(argumentsList, options) {
	const invocation = npmInvocation(argumentsList);
	return spawnSync(invocation.command, invocation.argumentsList, options);
}

function npmInvocation(argumentsList) {
	const npmExecPath = process.env.npm_execpath;
	if (npmExecPath !== undefined && npmExecPath.length > 0) {
		return { command: process.execPath, argumentsList: [npmExecPath, ...argumentsList] };
	}
	if (process.platform === 'win32') {
		const command = ['npm.cmd', ...argumentsList].map(quoteWindowsCommandArgument).join(' ');
		return {
			command: process.env.ComSpec ?? 'cmd.exe',
			argumentsList: ['/d', '/s', '/c', command],
		};
	}
	return { command: 'npm', argumentsList };
}

function quoteWindowsCommandArgument(value) {
	return `"${String(value).replaceAll('"', '""')}"`;
}
