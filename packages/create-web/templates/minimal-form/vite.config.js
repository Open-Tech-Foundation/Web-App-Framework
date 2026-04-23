import { defineConfig } from 'vite'
import { babel } from '@rollup/plugin-babel'

export default defineConfig({
  esbuild: {
    jsx: 'preserve'
  },
  optimizeDeps: {
    rolldownOptions: {
      jsx: 'preserve'
    }
  },
  plugins: [
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
  ]
})
