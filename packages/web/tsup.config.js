import { defineConfig } from 'tsup'

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
