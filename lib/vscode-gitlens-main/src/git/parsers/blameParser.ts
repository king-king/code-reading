'use strict';
import * as paths from 'path';
import { debug, Strings } from '../../system';
import { GitAuthor, GitBlame, GitBlameCommit, GitCommitLine, GitRevision, GitUser } from '../git';

const emptyStr = '';
const slash = '/';

interface BlameEntry {
	sha: string;

	line: number;
	originalLine: number;
	lineCount: number;

	author: string;
	authorDate?: string;
	authorTimeZone?: string;
	authorEmail?: string;

	committerDate?: string;
	committerTimeZone?: string;

	previousSha?: string;
	previousFileName?: string;

	fileName?: string;

	summary?: string;
}

export class GitBlameParser {
	@debug({ args: false, singleLine: true })
	static parse(
		data: string,
		repoPath: string | undefined,
		fileName: string,
		currentUser: GitUser | undefined,
	): GitBlame | undefined {
		if (!data) return undefined;

		const authors = new Map<string, GitAuthor>();
		const commits = new Map<string, GitBlameCommit>();
		const lines: GitCommitLine[] = [];

		let relativeFileName;

		let entry: BlameEntry | undefined = undefined;
		let line: string;
		let lineParts: string[];

		let first = true;

		for (line of Strings.lines(data)) {
			lineParts = line.split(' ');
			if (lineParts.length < 2) continue;

			if (entry === undefined) {
				entry = {
					author: undefined!,
					sha: lineParts[0],
					originalLine: parseInt(lineParts[1], 10),
					line: parseInt(lineParts[2], 10),
					lineCount: parseInt(lineParts[3], 10),
				};

				continue;
			}

			switch (lineParts[0]) {
				case 'author':
					if (GitRevision.isUncommitted(entry.sha)) {
						entry.author = 'You';
					} else {
						entry.author = lineParts.slice(1).join(' ').trim();
					}
					break;

				case 'author-mail': {
					if (GitRevision.isUncommitted(entry.sha)) {
						entry.authorEmail = currentUser !== undefined ? currentUser.email : undefined;
						continue;
					}

					entry.authorEmail = lineParts.slice(1).join(' ').trim();
					const start = entry.authorEmail.indexOf('<');
					if (start >= 0) {
						const end = entry.authorEmail.indexOf('>', start);
						if (end > start) {
							entry.authorEmail = entry.authorEmail.substring(start + 1, end);
						} else {
							entry.authorEmail = entry.authorEmail.substring(start + 1);
						}
					}

					break;
				}
				case 'author-time':
					entry.authorDate = lineParts[1];
					break;

				case 'author-tz':
					entry.authorTimeZone = lineParts[1];
					break;

				case 'committer-time':
					entry.committerDate = lineParts[1];
					break;

				case 'committer-tz':
					entry.committerTimeZone = lineParts[1];
					break;

				case 'summary':
					entry.summary = lineParts.slice(1).join(' ').trim();
					break;

				case 'previous':
					entry.previousSha = lineParts[1];
					entry.previousFileName = lineParts.slice(2).join(' ');
					break;

				case 'filename':
					entry.fileName = lineParts.slice(1).join(' ');

					if (first && repoPath === undefined) {
						// Try to get the repoPath from the most recent commit
						repoPath = Strings.normalizePath(
							fileName.replace(
								fileName.startsWith(slash) ? `/${entry.fileName}` : entry.fileName,
								emptyStr,
							),
						);
						relativeFileName = Strings.normalizePath(paths.relative(repoPath, fileName));
					} else {
						relativeFileName = entry.fileName;
					}
					first = false;

					GitBlameParser.parseEntry(entry, repoPath, relativeFileName, commits, authors, lines, currentUser);

					entry = undefined;
					break;

				default:
					break;
			}
		}

		for (const [, c] of commits) {
			if (c.author === undefined) return undefined;

			const author = authors.get(c.author);
			if (author === undefined) return undefined;

			author.lineCount += c.lines.length;
		}

		const sortedAuthors = new Map([...authors.entries()].sort((a, b) => b[1].lineCount - a[1].lineCount));

		const blame: GitBlame = {
			repoPath: repoPath!,
			authors: sortedAuthors,
			commits: commits,
			lines: lines,
		};
		return blame;
	}

	private static parseEntry(
		entry: BlameEntry,
		repoPath: string | undefined,
		relativeFileName: string,
		commits: Map<string, GitBlameCommit>,
		authors: Map<string, GitAuthor>,
		lines: GitCommitLine[],
		currentUser: { name?: string; email?: string } | undefined,
	) {
		let commit = commits.get(entry.sha);
		if (commit === undefined) {
			if (entry.author !== undefined) {
				if (
					currentUser !== undefined &&
					// Name or e-mail is configured
					(currentUser.name !== undefined || currentUser.email !== undefined) &&
					// Match on name if configured
					(currentUser.name === undefined || currentUser.name === entry.author) &&
					// Match on email if configured
					(currentUser.email === undefined || currentUser.email === entry.authorEmail)
				) {
					entry.author = 'You';
				}

				let author = authors.get(entry.author);
				if (author === undefined) {
					author = {
						name: entry.author,
						lineCount: 0,
					};
					authors.set(entry.author, author);
				}
			}

			commit = new GitBlameCommit(
				repoPath!,
				entry.sha,
				entry.author,
				entry.authorEmail,
				new Date((entry.authorDate as any) * 1000),
				new Date((entry.committerDate as any) * 1000),
				entry.summary!,
				relativeFileName,
				entry.previousFileName !== undefined && entry.previousFileName !== entry.fileName
					? entry.previousFileName
					: undefined,
				entry.previousSha,
				entry.previousSha && entry.previousFileName,
				[],
			);

			commits.set(entry.sha, commit);
		}

		for (let i = 0, len = entry.lineCount; i < len; i++) {
			const line: GitCommitLine = {
				sha: entry.sha,
				line: entry.line + i,
				originalLine: entry.originalLine + i,
			};

			if (commit.previousSha) {
				line.previousSha = commit.previousSha;
			}

			commit.lines.push(line);
			lines[line.line - 1] = line;
		}
	}
}
