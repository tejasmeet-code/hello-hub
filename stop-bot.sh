#!/bin/bash
# Change directory to the script's directory
cd "$(dirname "$0")"

echo "==========================================="
echo "🛑 Hello Hub Discord Bot Stop Tool"
echo "==========================================="

echo "🔴 Stopping the bot and updater processes in PM2..."
npx pm2 stop ecosystem.config.cjs || echo "⚠️ Processes are not currently running."
npx pm2 delete ecosystem.config.cjs || echo "⚠️ Processes are not in PM2 registry."

echo "==========================================="
echo "✅ Bot and updater have been stopped."
echo "==========================================="
