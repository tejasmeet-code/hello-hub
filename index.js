const { execSync } = require('child_process');
const path = require('path');

console.log('⚡ [Heaven Cloud Bootstrapper] Initializing PNPM workspaces and launching bot...');
try {
  // Ensure pnpm is installed globally in the container, link workspace dependencies, and start the bot
  execSync('npm install -g pnpm@latest && pnpm install && pnpm run start', {
    stdio: 'inherit',
    cwd: __dirname
  });
} catch (err) {
  console.error('❌ [Heaven Cloud Bootstrapper] Failed to start application:', err.message || err);
  process.exit(1);
}
