module.exports = {
  apps: [
    {
      name: 'channel-manager',
      cwd: '/var/www/channel-manager',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3002',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: '3002',
      },
      max_memory_restart: '512M',
    },
  ],
}
