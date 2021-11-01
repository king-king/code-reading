'use strict';
import * as paths from 'path';
import { findExecutable, run } from './shell';

export class UnableToFindGitError extends Error {
	constructor(public readonly original?: Error) {
		super('Unable to find git');

		Error.captureStackTrace(this, UnableToFindGitError);
	}
}

export class InvalidGitConfigError extends Error {
	constructor(public readonly original: Error) {
		super('Invalid Git configuration');

		Error.captureStackTrace(this, InvalidGitConfigError);
	}
}

export interface GitLocation {
	path: string;
	version: string;
}

function parseVersion(raw: string): string {
	return raw?.replace(/^git version /, '');
}

async function findSpecificGit(path: string): Promise<GitLocation> {
	let version;
	try {
		version = await run<string>(path, ['--version'], 'utf8');
	} catch (ex) {
		if (/bad config/i.test(ex.message)) throw new InvalidGitConfigError(ex);
		throw ex;
	}

	// If needed, let's update our path to avoid the search on every command
	if (!path || path === 'git') {
		const foundPath = findExecutable(path, ['--version']).cmd;

		// Ensure that the path we found works
		try {
			version = await run<string>(foundPath, ['--version'], 'utf8');
		} catch (ex) {
			if (/bad config/i.test(ex.message)) throw new InvalidGitConfigError(ex);
			throw ex;
		}

		path = foundPath;
	}

	return {
		path: path,
		version: parseVersion(version.trim()),
	};
}

async function findGitDarwin(): Promise<GitLocation> {
	try {
		let path = await run<string>('which', ['git'], 'utf8');
		path = path.replace(/^\s+|\s+$/g, '');

		if (path !== '/usr/bin/git') {
			return findSpecificGit(path);
		}

		try {
			await run<string>('xcode-select', ['-p'], 'utf8');
			return findSpecificGit(path);
		} catch (ex) {
			if (ex.code === 2) {
				return Promise.reject(new UnableToFindGitError(ex));
			}
			return findSpecificGit(path);
		}
	} catch (ex) {
		return Promise.reject(
			ex instanceof InvalidGitConfigError || ex instanceof UnableToFindGitError
				? ex
				: new UnableToFindGitError(ex),
		);
	}
}

function findSystemGitWin32(basePath: string | null | undefined): Promise<GitLocation> {
	if (basePath == null || basePath.length === 0) return Promise.reject(new UnableToFindGitError());
	return findSpecificGit(paths.join(basePath, 'Git', 'cmd', 'git.exe'));
}

function findGitWin32(): Promise<GitLocation> {
	return findSystemGitWin32(process.env['ProgramW6432'])
		.then(null, () => findSystemGitWin32(process.env['ProgramFiles(x86)']))
		.then(null, () => findSystemGitWin32(process.env['ProgramFiles']))
		.then(null, () => findSpecificGit('git'));
}

export async function findGitPath(paths?: string | string[]): Promise<GitLocation> {
	try {
		if (paths == null || typeof paths === 'string') {
			return await findSpecificGit(paths ?? 'git');
		}

		for (const path of paths) {
			try {
				return await findSpecificGit(path);
			} catch {}
		}

		throw new UnableToFindGitError();
	} catch {
		try {
			switch (process.platform) {
				case 'darwin':
					return await findGitDarwin();
				case 'win32':
					return await findGitWin32();
				default:
					return Promise.reject(new UnableToFindGitError());
			}
		} catch (ex) {
			return Promise.reject(
				ex instanceof InvalidGitConfigError || ex instanceof UnableToFindGitError
					? ex
					: new UnableToFindGitError(ex),
			);
		}
	}
}
