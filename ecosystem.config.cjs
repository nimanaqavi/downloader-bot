module.exports = {
  apps: [
    {
      name: "mimo-bot",
      script: "dist/src/index.js",
      cwd: "/home/telbot/mimo",
      env: {
        NODE_ENV: "production",
        PATH: "/home/telbot/bin:/home/telbot/.local/bin:" + (process.env.PATH || "")
      },
      max_memory_restart: "180M",
      restart_delay: 3000,
      autorestart: true
    }
  ]
};
