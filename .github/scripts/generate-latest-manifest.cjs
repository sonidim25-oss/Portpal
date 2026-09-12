const fs = require('fs');
const path = require('path');

const tag = process.env.GITHUB_REF_NAME || 'v0.5.0';
const repo = process.env.GITHUB_REPOSITORY || 'sonidim25-oss/Portpal';
const version = tag.replace(/^v/, '');

const platforms = {};

// Windows: find .exe and its signature
const winDir = path.resolve('artifacts/portpal-windows-setup');
if (fs.existsSync(winDir)) {
  const files = fs.readdirSync(winDir);
  const exe = files.find((f) => f.endsWith('.exe'));
  const sig = files.find((f) => f.endsWith('.sig'));
  if (exe && sig) {
    const signature = fs.readFileSync(path.join(winDir, sig), 'utf8').trim();
    platforms['windows-x86_64'] = {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${exe}`,
    };
  }
}

// Linux: find .AppImage and its signature
const linuxDir = path.resolve('artifacts/portpal-linux-appimage');
if (fs.existsSync(linuxDir)) {
  const files = fs.readdirSync(linuxDir);
  const appImage = files.find((f) => f.endsWith('.AppImage'));
  const sig = files.find((f) => f.endsWith('.sig'));
  if (appImage && sig) {
    const signature = fs.readFileSync(path.join(linuxDir, sig), 'utf8').trim();
    platforms['linux-x86_64'] = {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${appImage}`,
    };
  }
}

const manifest = {
  version: tag,
  notes: `PortPal ${tag} release`,
  pub_date: new Date().toISOString(),
  platforms,
};

fs.writeFileSync('latest.json', JSON.stringify(manifest, null, 2));
console.log('Successfully generated latest.json:');
console.log(JSON.stringify(manifest, null, 2));
