import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default ({ mode}: any) => {

  return defineConfig({
    envDir: "../../",
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            phaser: ["phaser"],
          },
        },
      },
    },
    server: {
      port: 3000,
      proxy: {
        "/.proxy/assets": {
          target: "http://localhost:3000/assets",
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/.proxy\/assets/, ""),
        },
        // Discord strips the /.proxy prefix before forwarding, so inside Discord requests arrive as /api/...,
        // while hitting localhost:3000 directly they arrive as /.proxy/api/... Both go to the server as /api/...
        "/.proxy/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
          secure: false,
          ws: true,
          rewrite: (path) => path.replace(/^\/\.proxy/, ""),
        },
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
      // no hmr.clientPort: the HMR client then uses the page's own port, which is 3000 on
      // localhost and the default 443 inside Discord (discordsays.com's CSP blocks any other port)
    },
  });
};
