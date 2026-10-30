'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { releaseInfo, publishRelease } = require('../../tools/github-release');

const env = { GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v1.2.3', GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'test-token' };
const pkg = { version: '1.2.3' };
const changelog = '# Changes\n\n## 1.2.3\n\n- New feature\n\n## 1.2.2\n\n- Previous\n';
const info = releaseInfo(env, pkg, changelog);
const response = (status, json = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => json });

test('タグと変更履歴を検証し、対象バージョンの内容だけを取り出す', () => {
  assert.deepEqual(info, { tag: 'v1.2.3', version: '1.2.3', notes: '- New feature' });
  assert.equal(releaseInfo(env, pkg, changelog.replaceAll('\n', '\r\n')).notes, '- New feature');
  assert.throws(() => releaseInfo({ ...env, GITHUB_REF_TYPE: 'branch' }, pkg, changelog));
  assert.throws(() => releaseInfo({ ...env, GITHUB_REF_NAME: 'v1.2.2' }, pkg, changelog));
  assert.throws(() => releaseInfo(env, pkg, '## 1.2.2\n- Other'));
  assert.throws(() => releaseInfo(env, pkg, '## 1.2.3\n\n## 1.2.2\n- Other'));
  assert.throws(() => releaseInfo(env, pkg, '## 1.2.3\n- A\n## 1.2.3\n- B'));
});

test('Release が存在しなければ既存タグから変更履歴付きで作成する', async () => {
  const calls = [];
  const request = async (url, options) => { calls.push({ url, options }); return calls.length === 1 ? response(404) : response(calls.length === 2 ? 200 : 201); };
  assert.equal(await publishRelease(info, env, request), 'created');
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /\/releases\/tags\/v1\.2\.3$/);
  assert.match(calls[1].url, /\/git\/ref\/tags\/v1\.2\.3$/);
  assert.deepEqual(JSON.parse(calls[2].options.body), { tag_name: 'v1.2.3', name: 'v1.2.3', body: '- New feature', draft: false, prerelease: false });
});

test('公開済み Release の再実行は変更しない', async () => {
  let count = 0;
  assert.equal(await publishRelease(info, env, async () => { count++; return response(200, { tag_name: info.tag, draft: false }); }), 'existing');
  assert.equal(count, 1);
});

test('下書き、照会エラー、作成エラーでは成功扱いにしない', async () => {
  await assert.rejects(publishRelease(info, env, async () => response(200, { tag_name: info.tag, draft: true })));
  let count = 0;
  await assert.rejects(publishRelease(info, env, async () => { count++; return response(403); }));
  assert.equal(count, 1);
  count = 0;
  await assert.rejects(publishRelease(info, env, async () => { count++; return response(404); }));
  assert.equal(count, 2);
  await assert.rejects(publishRelease(info, env, async (url, options) => options.method === 'POST' ? response(422) : response(url.includes('/git/ref/') ? 200 : 404)));
});
