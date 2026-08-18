// vite.config.ts
import { defineConfig } from "file:///c:/Users/lingg/projects/brain-gain/frontend/node_modules/vite/dist/node/index.js";
import vue from "file:///c:/Users/lingg/projects/brain-gain/frontend/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import basicSsl from "file:///c:/Users/lingg/projects/brain-gain/frontend/node_modules/@vitejs/plugin-basic-ssl/dist/index.mjs";
import { fileURLToPath, URL } from "node:url";
var __vite_injected_original_import_meta_url = "file:///c:/Users/lingg/projects/brain-gain/frontend/vite.config.ts";
var vite_config_default = defineConfig({
  // basicSsl serves the dev server over HTTPS with an auto-generated self-signed cert,
  // so the app is HTTPS-only in development too (browsers show a one-time warning).
  plugins: [vue(), basicSsl()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", __vite_injected_original_import_meta_url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      // Backend runs HTTPS with a self-signed cert in dev → target https + secure:false.
      "/api": { target: "https://localhost:3001", changeOrigin: true, secure: false }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJjOlxcXFxVc2Vyc1xcXFxsaW5nZ1xcXFxwcm9qZWN0c1xcXFxicmFpbi1nYWluXFxcXGZyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJjOlxcXFxVc2Vyc1xcXFxsaW5nZ1xcXFxwcm9qZWN0c1xcXFxicmFpbi1nYWluXFxcXGZyb250ZW5kXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9jOi9Vc2Vycy9saW5nZy9wcm9qZWN0cy9icmFpbi1nYWluL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCB2dWUgZnJvbSAnQHZpdGVqcy9wbHVnaW4tdnVlJztcclxuaW1wb3J0IGJhc2ljU3NsIGZyb20gJ0B2aXRlanMvcGx1Z2luLWJhc2ljLXNzbCc7XHJcbmltcG9ydCB7IGZpbGVVUkxUb1BhdGgsIFVSTCB9IGZyb20gJ25vZGU6dXJsJztcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcbiAgLy8gYmFzaWNTc2wgc2VydmVzIHRoZSBkZXYgc2VydmVyIG92ZXIgSFRUUFMgd2l0aCBhbiBhdXRvLWdlbmVyYXRlZCBzZWxmLXNpZ25lZCBjZXJ0LFxyXG4gIC8vIHNvIHRoZSBhcHAgaXMgSFRUUFMtb25seSBpbiBkZXZlbG9wbWVudCB0b28gKGJyb3dzZXJzIHNob3cgYSBvbmUtdGltZSB3YXJuaW5nKS5cclxuICBwbHVnaW5zOiBbdnVlKCksIGJhc2ljU3NsKCldLFxyXG4gIHJlc29sdmU6IHtcclxuICAgIGFsaWFzOiB7XHJcbiAgICAgICdAJzogZmlsZVVSTFRvUGF0aChuZXcgVVJMKCcuL3NyYycsIGltcG9ydC5tZXRhLnVybCkpLFxyXG4gICAgfSxcclxuICB9LFxyXG4gIHNlcnZlcjoge1xyXG4gICAgcG9ydDogNTE3MyxcclxuICAgIHByb3h5OiB7XHJcbiAgICAgIC8vIEJhY2tlbmQgcnVucyBIVFRQUyB3aXRoIGEgc2VsZi1zaWduZWQgY2VydCBpbiBkZXYgXHUyMTkyIHRhcmdldCBodHRwcyArIHNlY3VyZTpmYWxzZS5cclxuICAgICAgJy9hcGknOiB7IHRhcmdldDogJ2h0dHBzOi8vbG9jYWxob3N0OjMwMDEnLCBjaGFuZ2VPcmlnaW46IHRydWUsIHNlY3VyZTogZmFsc2UgfSxcclxuICAgIH0sXHJcbiAgfSxcclxufSk7XHJcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBK1QsU0FBUyxvQkFBb0I7QUFDNVYsT0FBTyxTQUFTO0FBQ2hCLE9BQU8sY0FBYztBQUNyQixTQUFTLGVBQWUsV0FBVztBQUhzSyxJQUFNLDJDQUEyQztBQUsxUCxJQUFPLHNCQUFRLGFBQWE7QUFBQTtBQUFBO0FBQUEsRUFHMUIsU0FBUyxDQUFDLElBQUksR0FBRyxTQUFTLENBQUM7QUFBQSxFQUMzQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLGNBQWMsSUFBSSxJQUFJLFNBQVMsd0NBQWUsQ0FBQztBQUFBLElBQ3REO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBO0FBQUEsTUFFTCxRQUFRLEVBQUUsUUFBUSwwQkFBMEIsY0FBYyxNQUFNLFFBQVEsTUFBTTtBQUFBLElBQ2hGO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
