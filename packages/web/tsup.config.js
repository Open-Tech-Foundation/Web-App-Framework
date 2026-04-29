import { defineConfig } from 'tsup'
import babel from '@babel/core'
import frameworkCompiler from './compiler/index.js'
import fs from 'fs'

const frameworkJSXPlugin = {
  name: 'framework-jsx',
  setup(build) {
    build.onLoad({ filter: /\.jsx$/ }, async (args) => {
      const code = await fs.promises.readFile(args.path, 'utf8')
      const result = await babel.transformAsync(code, {
        filename: args.path,
        plugins: [
          '@babel/plugin-syntax-jsx',
          [frameworkCompiler, { runtimeSource: '../runtime/index.js' }]
        ],
        sourceMaps: true,
        configFile: false,
        babelrc: false,
      })
      return { contents: result.code, loader: 'js' }
    })
  }
}

export default defineConfig({
  entry: {
    index: 'index.js',
    'compiler/babel-plugin': 'compiler/index.js',
    'router/index': 'router/index.js',
    'runtime/index': 'runtime/index.js',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  shims: true,
  esbuildPlugins: [frameworkJSXPlugin],
  external: ['@babel/core', '@preact/signals-core', '@babel/helper-module-imports'],
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    }
  },
  footer: {
    js: 'if (typeof module !== "undefined" && module.exports && module.exports.default) module.exports = module.exports.default;',
  },
})
