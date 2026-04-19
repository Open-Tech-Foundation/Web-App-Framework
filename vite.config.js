import { defineConfig } from 'vite'
import { babel } from '@rollup/plugin-babel'
import path from 'path'

export default defineConfig({
  esbuild: {
    jsx: 'preserve'
  },
  plugins: [
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      configFile: false,
      plugins: [
        "@babel/plugin-syntax-jsx",
        [path.resolve(__dirname, 'compiler/babel-plugin.cjs')]
      ]
    })
  ]
})
