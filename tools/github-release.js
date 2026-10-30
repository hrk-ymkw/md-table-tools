'use strict';

const fs = require('node:fs');

function releaseInfo(env, packageJson, changelog) {
  const version = packageJson.version;
  const tag = env.GITHUB_REF_NAME;
  if (env.GITHUB_REF_TYPE !== 'tag' || tag !== `v${version}`) {
    throw new Error(`タグは package.json のバージョンに一致する v${version} を指定してください。`);
  }
  const headings = [...changelog.matchAll(/^##\s+([^\r\n]+)\s*\r?$/gm)];
  const matches = headings.filter((heading) => heading[1].trim() === version);
  if (matches.length !== 1) throw new Error(`CHANGELOG.md に ## ${version} を1つ用意してください。`);
  const heading = matches[0];
  const next = headings.find((item) => item.index > heading.index);
  const notes = changelog.slice(heading.index + heading[0].length, next?.index).trim();
  if (!notes) throw new Error(`CHANGELOG.md の ${version} の変更内容が空です。`);
  return { tag, version, notes };
}

async function publishRelease(info, env, request = fetch) {
  if (!env.GH_TOKEN || !/^[^/]+\/[^/]+$/.test(env.GITHUB_REPOSITORY || '')) {
    throw new Error('GitHub トークンまたはリポジトリ名がありません。');
  }
  const base = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/releases`;
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${env.GH_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'md-table-tools-release',
  };
  const existing = await request(`${base}/tags/${encodeURIComponent(info.tag)}`, { headers });
  if (existing.ok) {
    const release = await existing.json();
    if (release.draft || release.tag_name !== info.tag) {
      throw new Error('同じタグの Release が下書きか、タグが一致しません。内容を確認してください。');
    }
    console.log(`${info.tag} の GitHub Release は作成済みです。`);
    return 'existing';
  }
  if (existing.status !== 404) throw new Error(`既存 Release の確認に失敗しました (HTTP ${existing.status})。`);

  // GitHub's create-release API can create a missing tag from the default branch.
  // Require the release tag to already exist instead of silently creating one.
  const tag = await request(`${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/git/ref/tags/${encodeURIComponent(info.tag)}`, { headers });
  if (!tag.ok) throw new Error(`公開対象のタグを確認できません (HTTP ${tag.status})。`);

  const created = await request(base, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: info.tag,
      name: info.tag,
      body: info.notes,
      draft: false,
      prerelease: info.version.includes('-'),
    }),
  });
  if (!created.ok) throw new Error(`GitHub Release の作成に失敗しました (HTTP ${created.status})。`);
  console.log(`${info.tag} の GitHub Release を作成しました。`);
  return 'created';
}

async function main() {
  const mode = process.argv[2];
  if (!['validate', 'publish'].includes(mode)) throw new Error('validate または publish を指定してください。');
  const info = releaseInfo(process.env, JSON.parse(fs.readFileSync('package.json', 'utf8')), fs.readFileSync('CHANGELOG.md', 'utf8'));
  if (mode === 'publish') await publishRelease(info, process.env);
  else console.log(`${info.tag} のタグと変更履歴を確認しました。`);
}

if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { releaseInfo, publishRelease };
