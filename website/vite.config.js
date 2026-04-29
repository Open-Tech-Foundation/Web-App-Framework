import { defineConfig } from 'vite'
import { babel } from '@rollup/plugin-babel'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development'

  return {
    root: '.',
    esbuild: {
      jsx: 'preserve'
    },
    resolve: {
      alias: isDev ? {
        '@opentf/web': path.resolve(__dirname, '../packages/web'),
        '@opentf/web-form': path.resolve(__dirname, '../packages/web-form'),
        '@opentf/web-ui': path.resolve(__dirname, '../packages/web-ui')
      } : {}
    },
    plugins: [
      tailwindcss(),
      babel({
        babelHelpers: 'bundled',
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        exclude: 'node_modules/**',
        configFile: false,
        plugins: [
          "@babel/plugin-syntax-jsx",
          ["@opentf/web/compiler"]
        ]
      })
    ],
    build: {
      outDir: 'dist',
      emptyOutDir: true
    }
  }
})
