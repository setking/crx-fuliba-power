import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }
import { ENABLED_SITES, UPLOAD_HOST } from './src/global'

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
  },
  action: {
    default_icon: {
      48: 'public/logo.png',
    },
    default_popup: 'src/popup/index.html',
  },
  // content_scripts 注入的域名白名单 —— 论坛可用站点来自 src/global.ts 的 ENABLED_SITES，
  // 额外追加 UPLOAD_HOST（图床上传通道），让 side panel 转发上传时也能命中 content script。
  content_scripts: [
    {
      js: ['src/content/main.ts'],
      matches: [
        ...ENABLED_SITES.map(site => `https://${site}/*`),
        `https://${UPLOAD_HOST}/*`,
      ],
    },
  ],
  background: {
    service_worker: 'src/background.ts',
  },
  permissions: ['sidePanel', 'contentSettings', 'tabs', 'storage'],
  host_permissions: ['<all_urls>'],
})
