import { defineConfig } from 'vite'
import { babel } from '@rollup/plugin-babel'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: '.',
  esbuild: {
    jsx: 'preserve'
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
        [path.resolve(__dirname, '../framework/compiler/babel-plugin.cjs')]
      ]
    })
  ],
  resolve: {
    alias: {
      '/framework': path.resolve(__dirname, '../framework')
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
