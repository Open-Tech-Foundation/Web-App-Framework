module.exports = {
  plugins: [
    "@babel/plugin-syntax-jsx",
    ["./dist/compiler/babel-plugin.cjs", { "runtimeSource": "../index.js" }]
  ]
};
