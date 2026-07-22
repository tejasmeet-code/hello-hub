#!/bin/bash
# Exit on error
set -e

# Change directory to the script's directory
cd "$(dirname "$0")"

echo "==========================================="
echo "🚀 Hello Hub Discord Bot Deployment Tool"
echo "==========================================="

# Check for .env file
if [ ! -f .env ]; then
  echo "❌ Error: .env file not found!"
  echo "Please create a .env file with your secrets before running the bot."
  echo "See .env.example for required variables."
  exit 1
fi

echo "📦 Installing any updated packages..."
npx pnpm install

echo "🛠️  Building the project..."
npx pnpm run build

echo "🔄 Pushing Drizzle Database Schema..."
node --env-file=.env -e "try { require('child_process').execSync('npx drizzle-kit push --config ./lib/db/drizzle.config.ts', { stdio: 'inherit' }); } catch(e) { console.log('⚠️ Warning: Database schema push failed or skipped. Make sure DATABASE_URL is valid.'); }"

echo "🟢 Launching/Restarting the bot with PM2..."
npx pm2 start ecosystem.config.cjs

echo "==========================================="
echo "✅ Bot is successfully starting in the background!"
echo "To monitor logs, run: npx pm2 logs hello-hub-bot"
echo "To stop the bot, run: ./stop-bot.sh"
echo "==========================================="
