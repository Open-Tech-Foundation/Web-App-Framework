#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prompts from 'prompts';
import { blue, cyan, green, red, reset, yellow, bold } from 'kolorist';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// True Orange Branding (using RGB ANSI if supported, falling back to yellow)
const orange = (str) => `\x1b[38;2;255;165;0m${str}${reset('')}`;

async function init() {
  console.log(`\n  ${bold(orange('Open Tech Foundation'))}`);
  console.log(`\n  ${bold(cyan('MWAF (Minimal Web App Framework)'))} ${yellow('Scaffolding Tool')} ✨\n`);

  let targetDir = process.argv[2];
  const defaultProjectName = targetDir || 'mwaf-app';

  let result = {};

  try {
    result = await prompts(
      [
        {
          type: targetDir ? null : 'text',
          name: 'projectName',
          message: reset('Project name:'),
          initial: defaultProjectName,
          onState: (state) => {
            targetDir = state.value.trim() || defaultProjectName;
          },
        },
        {
          type: () => (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0 ? 'confirm' : null),
          name: 'overwrite',
          message: () =>
            (targetDir === '.' ? 'Current directory' : `Target directory "${targetDir}"`) +
            ` is not empty. Remove existing files and continue?`,
        },
        {
          type: (_, { overwrite } = {}) => {
            if (overwrite === false) {
              throw new Error(red('✖') + ' Operation cancelled');
            }
            return null;
          },
          name: 'overwriteChecker',
        },
        {
          type: 'select',
          name: 'styling',
          message: reset('Select a styling solution:'),
          initial: 1,
          choices: [
            { title: reset('None'), value: 'none', description: 'Plain CSS' },
            { title: cyan('TailwindCSS'), value: 'tailwind', description: 'Pre-configured TailwindCSS v4' },
          ],
        },
        {
          type: 'toggle',
          name: 'includeForms',
          message: reset(`Add ${cyan("Framework's Reactive Form manager")}?`),
          initial: true,
          active: 'yes',
          inactive: 'no'
        },
        {
          type: 'toggle',
          name: 'includeUI',
          message: reset(`Add ${cyan("Framework's UI Components")}?`),
          initial: false,
          active: 'yes',
          inactive: 'no'
        }
      ],
      {
        onCancel: () => {
          throw new Error(red('✖') + ' Operation cancelled');
        },
      }
    );
  } catch (cancelled) {
    console.log(cancelled.message);
    return;
  }

  const { styling, includeForms, includeUI, overwrite } = result;

  const root = path.join(process.cwd(), targetDir);

  if (overwrite) {
    emptyDir(root);
  } else if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }

  // We use the 'bare' template as the foundation for ALL projects
  const templateDir = path.resolve(__dirname, '../templates/bare');

  const write = (file, content) => {
    const targetPath = path.join(root, file);
    if (content) {
      fs.writeFileSync(targetPath, content);
    } else {
      copy(path.join(templateDir, file), targetPath);
    }
  };

  const files = fs.readdirSync(templateDir);
  for (const file of files) {
    if (file === 'package.json') {
      const pkg = JSON.parse(fs.readFileSync(path.join(templateDir, file), 'utf-8'));
      pkg.name = targetDir;
      
      // Dynamic Styling Injection
      if (styling === 'tailwind') {
        pkg.devDependencies = {
          ...pkg.devDependencies,
          "tailwindcss": "^4.2.2",
          "@tailwindcss/vite": "^4.2.2"
        };
      }
      
      // Dynamic Feature Injection
      if (includeForms) {
        pkg.dependencies["@opentf/mwaf-form"] = "^1.0.0";
      }
      if (includeUI) {
        pkg.dependencies["@opentf/mwaf-ui"] = "^0.1.0";
      }

      // LOCAL DEV HACK: If we are in the monorepo, link packages locally so the user can test
      const isInMonorepo = fs.existsSync(path.resolve(__dirname, '../../../packages'));
      if (isInMonorepo) {
        Object.keys(pkg.dependencies).forEach(dep => {
          if (dep.startsWith('@opentf/')) {
            const pkgName = dep.split('/')[1];
            pkg.dependencies[dep] = `file:${path.resolve(__dirname, '../../../packages', pkgName)}`;
          }
        });
      }
      
      write(file, JSON.stringify(pkg, null, 2));
    } else if (file === 'vite.config.js') {
      let content = fs.readFileSync(path.join(templateDir, file), 'utf-8');
      
      if (styling === 'tailwind') {
        content = content.replace(
          "import { babel } from '@rollup/plugin-babel'",
          "import { babel } from '@rollup/plugin-babel'\nimport tailwindcss from '@tailwindcss/vite'"
        );
        content = content.replace(
          "plugins: [",
          "plugins: [\n    tailwindcss(),"
        );
      }
      
      write(file, content);
    } else if (file === 'app') {
       copy(path.join(templateDir, file), path.join(root, file));
    } else {
      write(file);
    }
  }

  // Inject Feature Pages
  if (includeForms) {
    const formTemplateApp = path.resolve(__dirname, '../templates/minimal-form/app/form-example');
    copyDir(formTemplateApp, path.join(root, 'app/form-example'));
    
    // Update layout to include link if we want (optional, but good for DX)
  }

  if (includeUI) {
    // Placeholder for UI example
    fs.mkdirSync(path.join(root, 'app/ui-demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'app/ui-demo/page.jsx'), 
      `export default function UIDemo() {\n  return <div>MWAF UI Components coming soon!</div>\n}`
    );
  }

  // If Tailwind, create the CSS file
  if (styling === 'tailwind') {
    const cssPath = path.join(root, 'style.css');
    fs.writeFileSync(cssPath, '@import "tailwindcss";\n');
    
    let html = fs.readFileSync(path.join(root, 'index.html'), 'utf-8');
    if (!html.includes('style.css')) {
       html = html.replace('</head>', '  <link rel="stylesheet" href="/style.css" />\n  </head>');
       fs.writeFileSync(path.join(root, 'index.html'), html);
    }
  }

  console.log(`\n${green('✔')} ${bold(cyan('MWAF'))} project created! 🚀\n`);
  console.log(`  ${reset('Please run the following commands to get started:')}\n`);
  console.log(`  ${cyan(`cd ${path.relative(process.cwd(), root)}`)}`);
  console.log(`  ${cyan('npm install')}`);
  console.log(`  ${cyan('npm run dev')}\n`);
}

function copy(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    copyDir(src, dest);
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    const srcFile = path.resolve(srcDir, file);
    const destFile = path.resolve(destDir, file);
    copy(srcFile, destFile);
  }
}

function emptyDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const file of fs.readdirSync(dir)) {
    fs.rmSync(path.resolve(dir, file), { recursive: true, force: true });
  }
}

init().catch((e) => {
  console.error(e);
});
