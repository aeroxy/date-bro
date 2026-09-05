import tailwindcss from '@tailwindcss/vite'
import { mkdirSync, readFileSync } from 'node:fs'
import { defineConfig } from 'wxt'

const chromeProfile = '.wxt/chrome-data'
mkdirSync(chromeProfile, { recursive: true })

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  webExt: {
    chromiumProfile: chromeProfile,
    keepProfileChanges: true,
    chromiumArgs: ['--hide-crash-restore-bubble'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __VERSION__: JSON.stringify(pkg.version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
    build: {
      // Deliberate. This is loaded unpacked, never from the Web Store, so
      // bundle size buys nothing — and readable output means anyone can audit
      // what the extension does with their conversations before running it.
      minify: false,
    },
  }),
  manifest: {
    name: 'Date Bro',
    description: 'AI dating coach — build a picture of your date, and know what to say next',
    // `cookies` + `declarativeNetRequest` are for the Qwen backend only (it
    // borrows the user's chat.qwen.ai session). `tabs` + `scripting` have two
    // users: reading the auth token out of an open Qwen tab, and the four
    // importers in `lib/import/`, which run an injected function in a
    // conversation tab the user already has open. `storage` holds settings,
    // everything else lives in IndexedDB inside the app page.
    permissions: ['storage', 'tabs', 'scripting', 'cookies', 'declarativeNetRequest'],
    host_permissions: ['*://*/*'],
    icons: {
      16: 'assets/icon-16.png',
      32: 'assets/icon-32.png',
      48: 'assets/icon-48.png',
      128: 'assets/icon-128.png',
    },
    action: {
      default_title: 'Open Date Bro',
    },
  },
})
