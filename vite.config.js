import { defineConfig } from 'vite'
import { babel } from '@rollup/plugin-babel'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  esbuild: {
    jsx: 'preserve'
  },
  plugins: [
    tailwindcss(),
    babel({
      babelHelpers: 'bundled',
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.wc.jsx', '.wc.tsx'],
      configFile: false,
      plugins: [
        "@babel/plugin-syntax-jsx",
        [path.resolve(__dirname, 'framework/compiler/babel-plugin.cjs')]
      ]
    })
  ]
})
