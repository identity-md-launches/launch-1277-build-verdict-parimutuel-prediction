import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(folder, e.name)) : [path.join(folder, e.name)]);
const dist = path.join(root, 'dist');
const files = walk(dist).sort();
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
assert.match(html, /<title>Verdict<\/title>/);
for (const meta of ['description', 'og:title', 'og:image']) assert.ok(html.includes(`="${meta}"`), `Missing ${meta}`);
assert.ok(html.includes('rel="icon"'));
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  assert.ok(match[1].startsWith('./'), 'Runtime asset URL must be relative: ' + match[1]);
  assert.ok(fs.existsSync(path.resolve(dist, match[1])), 'Missing runtime asset: ' + match[1]);
}
for (const file of files.filter(f => f.endsWith('.css'))) {
  const css = fs.readFileSync(file, 'utf8');
  for (const match of css.matchAll(/url\(["']?([^\)"']+)["']?\)/g)) {
    if (match[1].startsWith('data:')) continue;
    assert.ok(!/^https?:|^\//.test(match[1]), 'CSS asset URL must be relative');
    assert.ok(fs.existsSync(path.resolve(path.dirname(file), match[1])), 'Missing CSS asset');
  }
}
const allNew = [...walk(path.join(root, 'web')), ...files];
assert.ok(!allNew.some(f => /(?:^|\/)(?:node_modules|\.cache|\.vite)(?:\/|$)|\.tgz$|\.log$/.test(f)), 'Dependency/cache files must stay out of the deliverable');
const runtime = files.filter(f => f.endsWith('.js')).map(f => fs.readFileSync(f, 'utf8')).join('\n');
assert.ok(!runtime.includes('Browser test wallet') && !runtime.includes('Does WETH9 (') && !runtime.includes('chain-fixture.json'), 'Test fixtures must not enter the production bundle');
const forbidden = ['foundry.toml','foundry.lock','remappings.txt','.gitmodules','lib','package.json','package-lock.json','.github'];
assert.equal(execFileSync('git',['diff','--name-only','--',...forbidden],{cwd:root,encoding:'utf8'}).trim(),'','Existing build configuration/dependencies must be unchanged');
const prospective = [...new Set(execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))].filter(f => fs.existsSync(path.join(root,f)) && fs.statSync(path.join(root,f)).isFile() && f !== 'web/validation/export-integrity.json');
const treeBytes = prospective.reduce((sum,f)=>sum+fs.statSync(path.join(root,f)).size,0);
const objectDirectory = execFileSync('git',['rev-parse','--git-path','objects'],{cwd:root,encoding:'utf8'}).trim();
const oldObjectBytes = walk(path.resolve(root, objectDirectory)).reduce((sum,f)=>sum+fs.statSync(f).size,0);
// Raw new tree + all existing compressed Git objects + generous object/header reserve.
// This is a conservative budget check, not a claim that the publisher's bundle was produced here.
const budgetBound = treeBytes + oldObjectBytes + 200000;
assert.ok(budgetBound < 8388608, 'Conservative submission budget exceeds 8 MiB');
const report = {
  checkedAt: new Date().toISOString(), siteLabel: 'verdict', buildDirectory: 'dist',
  exportBytes: files.reduce((sum,f)=>sum+fs.statSync(f).size,0),
  prospectiveTreeBytesExcludingThisReport: treeBytes, existingGitObjectBytes: oldObjectBytes,
  conservativeBundleBudgetBytes: budgetBound, maximumBundleBytes: 8388608,
  assertions: ['Title/description/OG/favicon present','All runtime HTML/CSS assets relative and present','No dependency/cache directories or archives','No captured market fixtures in runtime JS','Existing build configuration and dependencies unchanged','Conservative bundle size below 8 MiB'],
  assets: files.map(f=>({path:path.relative(root,f),bytes:fs.statSync(f).size,sha256:createHash('sha256').update(fs.readFileSync(f)).digest('hex')})),
};
fs.mkdirSync(path.join(root,'web/validation'),{recursive:true});
fs.writeFileSync(path.join(root,'web/validation/export-integrity.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
