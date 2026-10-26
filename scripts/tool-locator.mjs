import { accessSync, constants } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

function executable(path) {
  if (!path) return null;
  try {
    accessSync(path, constants.X_OK);
    return path;
  } catch {
    return null;
  }
}

export function keytoolPath(environment = process.env) {
  if (environment.RELAYDECK_TEST_KEYTOOL) {
    const explicit = executable(environment.RELAYDECK_TEST_KEYTOOL);
    if (explicit) return explicit;
  }
  if (environment.RELAYDECK_KEYTOOL) {
    const explicit = executable(environment.RELAYDECK_KEYTOOL);
    if (explicit) return explicit;
  }
  const candidates = [];
  if (environment.JAVA_HOME) candidates.push(join(environment.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool'));
  for (const directory of String(environment.PATH || '').split(delimiter)) {
    if (directory) candidates.push(join(directory, process.platform === 'win32' ? 'keytool.exe' : 'keytool'));
  }
  if (process.platform === 'win32') {
    candidates.push(
      'D:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe',
      'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\keytool.exe',
    );
  }
  candidates.push(join(dirname(process.execPath), process.platform === 'win32' ? 'keytool.exe' : 'keytool'));
  for (const candidate of candidates) {
    const resolved = executable(candidate);
    if (resolved) return resolved;
  }
  throw Error('未找到 keytool，请安装 JDK 17 或设置 RELAYDECK_KEYTOOL');
}

