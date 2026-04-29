import { getImportHelper } from "./helpers.js";
import { handleJSXVisitor, transformComponent } from "./visitor.js";

export default function (babel) {
  const { types: t } = babel;

  return {
    name: "web-compiler",
    visitor: {
      Program: {
        enter(p, state) {
          state.runtimeSource = state.opts.runtimeSource || "@opentf/web";
          state.importsNeeded = new Map();
          state.importSources = new Map();
          state.components = new Map(); 
          
          const filename = state.filename || "";
          const pagePatterns = ["page.jsx", "page.tsx", "layout.jsx", "layout.tsx", "404.jsx", "404.tsx"];
          state.isPageFile = pagePatterns.some(p => filename.endsWith(p));
        },
        exit(p, state) {
          state.components.forEach((info, name) => {
            const isRenderFn = state.isPageFile && info.isDefault;
            transformComponent(info.path, name, isRenderFn, t, state);
          });
        }
      },

      FunctionDeclaration(path, state) {
        if (!path.node.id) return;
        const name = path.node.id.name;
        if (/^[A-Z]/.test(name)) {
          let hasJSX = false;
          path.traverse({
            JSXElement() { hasJSX = true; },
            JSXFragment() { hasJSX = true; }
          });

          if (!hasJSX) return;

          const propsNode = path.node.params[0];
          const observedAttributes = new Set();
          
          if (t.isObjectPattern(propsNode)) {
            propsNode.properties.forEach(prop => {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                observedAttributes.add(prop.key.name);
              }
            });
          }
          
          if (state.components.has(name)) {
            const info = state.components.get(name);
            info.observedAttributes = observedAttributes;
            info.path = path;
          } else {
            state.components.set(name, { path, isDefault: false, observedAttributes });
          }
        }
      },

      ExportDefaultDeclaration(path, state) {
        const decl = path.node.declaration;
        if (t.isFunctionDeclaration(decl)) {
          let hasJSX = false;
          path.traverse({
            JSXElement() { hasJSX = true; },
            JSXFragment() { hasJSX = true; }
          });

          if (!hasJSX) return;

          if (decl.id) {
            const name = decl.id.name;
            if (state.components.has(name)) {
              state.components.get(name).isDefault = true;
            } else {
              state.components.set(name, { path: path.get("declaration"), isDefault: true });
            }
          } else {
            state.components.set("_default", { path: path.get("declaration"), isDefault: true });
          }
        }
      },

      ImportDeclaration(path, state) {
        const source = path.node.source.value;
        path.node.specifiers.forEach(spec => {
          if (t.isImportDefaultSpecifier(spec) || t.isImportSpecifier(spec)) {
            state.importSources.set(spec.local.name, source);
          }
        });
      },

      CallExpression(path, state) {
        if (t.isIdentifier(path.node.callee)) {
          const name = path.node.callee.name;
          const getImport = getImportHelper(t, path, state);

          if (name === "$state" || name === "$derived" || name === "$ref") {
            const parent = path.findParent(p => p.isVariableDeclarator());
            if (parent && t.isIdentifier(parent.node.id)) {
              if (!state.stateVars) state.stateVars = new Set();
              state.stateVars.add(parent.node.id.name);
            }
            if (name === "$state") {
              path.get("callee").replaceWith(getImport("signal", state.runtimeSource));
            } else if (name === "$derived") {
              path.get("callee").replaceWith(getImport("computed", state.runtimeSource));
            } else if (name === "$ref") {
              const parent = path.findParent(p => p.isVariableDeclarator());
              if (parent && t.isIdentifier(parent.node.id)) {
                if (!state.refVars) state.refVars = new Set();
                state.refVars.add(parent.node.id.name);
                if (!state.stateVars) state.stateVars = new Set();
                state.stateVars.add(parent.node.id.name);
              }
              path.get("callee").replaceWith(getImport("signal", state.runtimeSource));
            }
          } else if (name === "$effect") {
            path.get("callee").replaceWith(getImport("effect", state.runtimeSource));
          } else if (name === "$expose") {
            path.get("callee").replaceWith(t.memberExpression(t.identifier("Object"), t.identifier("assign")));
            path.node.arguments.unshift(t.thisExpression());
          } else if (name === "onMount") {
            path.get("callee").replaceWith(getImport("onMount", state.runtimeSource));
          } else if (name === "onCleanup") {
            path.get("callee").replaceWith(getImport("onCleanup", state.runtimeSource));
          } else if (name === "$renderDynamic") {
            path.get("callee").replaceWith(getImport("renderDynamic", state.runtimeSource));
          }
        }
      },

      Identifier(path, state) {
        if (!state.stateVars || !state.stateVars.has(path.node.name)) return;
        if (path.node._processed) return;
        
        if (path.parentPath.isMemberExpression() && !path.parentPath.node.computed) {
          if (t.isIdentifier(path.parentPath.node.property, { name: "value" })) {
            throw path.parentPath.buildCodeFrameError(
              `Manual .value access is forbidden for variables declared with $state. The Web App Framework compiler handles this automatically. Remove the .value from '${path.node.name}.value'.`
            );
          }
          if (path.parentPath.node.property === path.node) return;
        }

        if (path.parentPath.isVariableDeclarator() && path.parentPath.node.id === path.node) return;
        if (path.parentPath.isObjectProperty() && path.parentPath.node.key === path.node && !path.parentPath.node.computed) return;
        if (path.parentPath.isClassProperty() && path.parentPath.node.key === path.node) return;
        if (path.parentPath.isClassMethod() && path.parentPath.node.key === path.node) return;

        const innerId = t.identifier(path.node.name);
        innerId._processed = true;
        const newNode = t.memberExpression(innerId, t.identifier("value"));
        path.replaceWith(newNode);
      },

      AssignmentExpression(path, state) {
        if (t.isIdentifier(path.node.left) && state.stateVars?.has(path.node.left.name)) {
          const innerId = t.identifier(path.node.left.name);
          innerId._processed = true;
          path.node.left = t.memberExpression(innerId, t.identifier("value"));
        }
      },

      UpdateExpression(path, state) {
        if (t.isIdentifier(path.node.argument) && state.stateVars?.has(path.node.argument.name)) {
          const innerId = t.identifier(path.node.argument.name);
          innerId._processed = true;
          path.node.argument = t.memberExpression(innerId, t.identifier("value"));
        }
      },

      JSXElement(path, state) {
        handleJSXVisitor(path, state, t);
      },

      JSXFragment(path, state) {
        handleJSXVisitor(path, state, t);
      }
    }
  };
}
