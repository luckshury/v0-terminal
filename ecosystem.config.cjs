// PM2 Ecosystem Configuration
// 
// This runs your data fetching scripts on a schedule
// 
// Install PM2 globally: npm install -g pm2
// Start the jobs: pm2 start ecosystem.config.cjs
// View logs: pm2 logs
// Stop all: pm2 stop all
// Monitor: pm2 monit

module.exports = {
  apps: [
    // =========================================================
    // 24/7 WebSocket Connections (always running, auto-restart)
    // =========================================================
    
    // =========================================================
    // Scheduled Jobs (cron-based)
    // =========================================================
    {
      name: 'fetch-trader-snapshots',
      script: 'npx',
      args: 'tsx scripts/fetch-trader-snapshots.ts',
      cwd: __dirname,
      cron_restart: '*/10 * * * *', // Every 10 minutes
      autorestart: false,
      watch: false,
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'fetch-account-snapshots',
      script: 'npx',
      args: 'tsx scripts/fetch-account-snapshots.ts',
      cwd: __dirname,
      cron_restart: '*/10 * * * *', // Every 10 minutes
      autorestart: false,
      watch: false,
      instances: 1,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
}

