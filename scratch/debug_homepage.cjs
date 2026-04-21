const babel = require("@babel/core");
const path = require("path");
const fs = require("fs");

const code = fs.readFileSync("/home/G/projects/lab/waf/website/app/page.jsx", "utf8");
const pluginPath = "/home/G/projects/lab/waf/framework/compiler/babel-plugin.cjs";

const output = babel.transformSync(code, {
  plugins: [
    "@babel/plugin-syntax-jsx",
    [pluginPath]
  ],
  filename: "HomePage.jsx"
});

console.log(output.code);
