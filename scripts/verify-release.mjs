import { readFileSync } from 'node:fs';
import { release } from './release-info.mjs';

const read = relative => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const plugin = JSON.parse(read('plugins/relaydeck-desktop/.codex-plugin/plugin.json'));
const gradle = read('android/app/build.gradle');
const desktopBuilder = read('scripts/build-desktop-plugin.ps1');
const desktopNative = read('scripts/prepare-desktop-native.ps1');
const easyTierManager = read('desktop/easytier.mjs');
const desktopPage = read('desktop/web/index.html');
const failures = [];
if (packageJson.version !== release.version) failures.push('package.json');
if (plugin.version !== release.version) failures.push('plugin.json');
if (!new RegExp(`versionName\\s+['"]${release.version.replaceAll('.', '\\.')}['"]`).test(gradle) && !gradle.includes('releaseMetadata.version')) failures.push('android versionName');
if (!new RegExp(`versionCode\\s+${release.versionCode}(?:\\D|$)`).test(gradle) && !gradle.includes('releaseMetadata.versionCode')) failures.push('android versionCode');
if (!gradle.includes('release.json')) failures.push('android release.json wiring');
if (!desktopBuilder.includes("$taskRelease.easytierVersion")) failures.push('desktop builder EasyTier metadata');
if (new RegExp(`\\b2\\.6\\.4\\b`).test(desktopBuilder)) failures.push('desktop builder hard-coded EasyTier version');
if (!desktopBuilder.includes("'release.json') -Destination $taskPlugin")) failures.push('desktop bundle release metadata');
if (new RegExp(`\\b2\\.6\\.4\\b`).test(desktopNative)) failures.push('native installer hard-coded EasyTier version');
if (!desktopNative.includes("easytierVersion")) failures.push('native installer EasyTier metadata');
if (!easyTierManager.includes("release.easytierVersion")) failures.push('EasyTier status metadata');
if (!desktopPage.includes('id="etVersion"')) failures.push('desktop EasyTier version placeholder');
if (/\b2\.6\.4\b/.test(desktopPage)) failures.push('desktop page hard-coded EasyTier version');
if (failures.length) throw Error(`Release metadata mismatch: ${failures.join(', ')}`);
console.log(`Release metadata verified: ${release.version} (${release.versionCode})`);


