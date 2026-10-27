import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { release, tag as defaultTag } from './release-info.mjs';

const tag = process.env.RELAYDECK_RELEASE_TAG || defaultTag;
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) throw Error('Invalid release tag');
const version = tag.slice(1);
if (version !== release.version) throw Error(`Release tag ${tag} does not match release.json ${release.version}`);
const repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
if (!repo) throw Error('Set GH_REPO or GITHUB_REPOSITORY');
const gh = args => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const remoteRelease = JSON.parse(gh(['api', `repos/${repo}/releases/tags/${tag}`]));
const rows = [];
for (const name of [`relaydeck-desktop-${version}.zip`, `relaydeck-${version}.apk`]) {
  const asset = remoteRelease.assets.find(row => row.name === name);
  if (!asset) continue;
  let digest = asset.digest?.match(/^sha256:([a-f0-9]{64})$/i)?.[1];
  if (!digest) {
    const response = await fetch(asset.browser_download_url);
    if (!response.ok || !response.body) throw Error(`Cannot verify ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of response.body) hash.update(chunk);
    digest = hash.digest('hex');
  }
  rows.push(`${digest.toLowerCase()}  ${name}`);
}
if (rows.length !== 2) throw Error('Both installation packages must exist before updating release notes');
const introduction = (await readFile(`docs/release-${version}.md`, 'utf8')).split('\n## SHA-256')[0].trimEnd();
const notes = `${introduction}\n\n## SHA-256\n\n下载后可使用以下 SHA-256 核对文件完整性：\n\n\`\`\`text\n${rows.join('\n')}\n\`\`\`\n`;
const file = join(tmpdir(), `relaydeck-release-notes-${process.pid}.md`);
await writeFile(file, notes);
gh(['release', 'edit', tag, '--repo', repo, '--notes-file', file]);
// Remove only the two obsolete checksum downloads explicitly requested by the owner.
for (const name of ['SHA256SUMS.txt', 'SHA256SUMS-android.txt']) {
  if (remoteRelease.assets.some(row => row.name === name)) gh(['release', 'delete-asset', tag, name, '--repo', repo, '--yes']);
}
console.log('Release introduction updated; installer packages retained.');
