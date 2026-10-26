import { readFileSync } from 'node:fs';

const value = JSON.parse(readFileSync(new URL('../release.json', import.meta.url), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version)) throw Error('release.json version is invalid');
if (!Number.isSafeInteger(value.versionCode) || value.versionCode < 1) throw Error('release.json versionCode is invalid');
if (typeof value.easytierVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.easytierVersion)) throw Error('release.json easytierVersion is invalid');
export const release = Object.freeze(value);
export const tag = `v${release.version}`;
