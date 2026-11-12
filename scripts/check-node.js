import { versions, stderr, exit } from 'node:process';

const [major, minor] = versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  stderr.write(
    `Node.js ${versions.node} is too old. This app requires Node.js 22.13 or newer.\n` +
      'Install a current Node.js LTS release from https://nodejs.org, reopen your terminal, then run npm ci and npm run check.\n',
  );
  exit(1);
}
