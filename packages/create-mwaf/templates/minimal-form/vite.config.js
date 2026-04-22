import { defineConfig } from 'vite'
import { babel } from '@rollup/plugin-babel'
import mwafCompiler from '@opentf/mwaf-core/compiler'

export default defineConfig({
  esbuild: {
    jsx: 'preserve'
  },
  plugins: [
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      exclude: 'node_modules/**',
      configFile: false,
      plugins: [
        "@babel/plugin-syntax-jsx",
        [mwafCompiler]
      ]
    })
  ]
})
