const { execSync } = require('child_process');
const path = require('path');

const CHECK_INTERVAL = 2 * 60 * 1000; // Check every 2 minutes

console.log('🔄 Relosta Bot Auto-Updater initialized.');

function checkForUpdates() {
  try {
    const cwd = path.resolve(__dirname, '..');
    
    // Fetch remote changes
    execSync('git fetch origin main', { cwd });
    
    // Check if local commit matches remote commit
    const localCommit = execSync('git rev-parse HEAD', { cwd }).toString().trim();
    const remoteCommit = execSync('git rev-parse origin/main', { cwd }).toString().trim();
    
    if (localCommit !== remoteCommit) {
      console.log(`🚀 New updates detected on GitHub! (${localCommit} -> ${remoteCommit})`);
      
      console.log('📦 Stashing local modifications...');
      execSync('git stash', { cwd });
      
      console.log('📥 Pulling remote updates...');
      execSync('git pull origin main', { cwd });
      
      console.log('📤 Restoring local modifications...');
      try {
        execSync('git stash pop', { cwd });
      } catch (stashErr) {
        console.warn('⚠️ Stash pop encountered conflicts, applying auto-resolution...');
        // Prefer local modifications for our configurations/fixes if they conflict
        execSync('git checkout --theirs pnpm-workspace.yaml artifacts/mockup-sandbox/vite.config.ts artifacts/api-server/src/discord/utils/embedStyle.ts || true', { cwd });
        // Clear conflict markers for any other files by keeping remote changes
        execSync('git checkout --ours . || true', { cwd });
        execSync('git add . || true', { cwd });
        execSync('git reset HEAD || true', { cwd });
        execSync('git stash drop || true', { cwd });
      }
      
      console.log('🛠️ Rebuilding and restarting the bot...');
      execSync('./start-bot.sh', { cwd, stdio: 'inherit' });
      console.log('✅ Bot successfully updated and restarted!');
    }
  } catch (err) {
    console.error('❌ Error checking or applying updates:', err.message || err);
  }
}

// Run update check
checkForUpdates();
setInterval(checkForUpdates, CHECK_INTERVAL);
