// Local packaging only: no AWS imports, credentials, uploads or deployment.
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
await mkdir('.lambda-build', { recursive: true });
await build({ entryPoints: ['server/lambda.ts'], outfile: '.lambda-build/index.mjs', bundle: true, platform: 'node', target: 'node24', format: 'esm', minify: true, sourcemap: false, banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
execFileSync('python3', ['-c', "from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED; from pathlib import Path; data=Path('.lambda-build/index.mjs').read_bytes(); info=ZipInfo('index.mjs',(2020,1,1,0,0,0)); info.compress_type=ZIP_DEFLATED; info.external_attr=0o100644<<16; z=ZipFile('.lambda-build/great-circle-api.zip','w'); z.writestr(info,data); z.close()"], { stdio: ['ignore', 'pipe', 'pipe'] });
for (const file of ['index.mjs', 'great-circle-api.zip']) { const bytes = await readFile(`.lambda-build/${file}`); console.log(JSON.stringify({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), codeSha256Base64: createHash('sha256').update(bytes).digest('base64') })); }
