const { addNamed } = require("@babel/helper-module-imports");
const path = require("path");

module.exports = function (babel) {
  const { types: t } = babel;

  return {
    name: "waf-compiler",
    visitor: {
      Program: {
        enter(p, state) {
          state.importsNeeded = new Map();
          state.importSources = new Map();
          state.components = new Map(); // name -> { path, isDefault, isPage }
          
          const filename = state.filename || "";
          state.isPageFile = filename.endsWith("page.jsx") || filename.endsWith("page.tsx") || filename.endsWith(".page.jsx") || filename.endsWith(".page.tsx");
        },
        exit(p, state) {
          // Process all collected components
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
          if (decl.id) {
            const name = decl.id.name;
            if (state.components.has(name)) {
              state.components.get(name).isDefault = true;
            } else {
              state.components.set(name, { path: path.get("declaration"), isDefault: true });
            }
          } else {
            // Anonymous function
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
      }
    }
  };

  function transformComponent(componentPath, name, isRenderFn, t, state) {
    const node = componentPath.node;
    const body = node.body;

    const getImport = (importName, source) => {
      const key = `${importName}:${source}`;
      if (!state.importsNeeded.has(key)) {
        state.importsNeeded.set(key, addNamed(componentPath, importName, source));
      }
      return state.importsNeeded.get(key);
    };

    let jsxNode = null;
    const originalStatements = [];

    body.body.forEach(stmt => {
      if (t.isReturnStatement(stmt) && (t.isJSXElement(stmt.argument) || t.isJSXFragment(stmt.argument))) {
        jsxNode = stmt.argument;
      } else {
        originalStatements.push(stmt);
      }
    });

    if (!jsxNode) return;

    // Transform global-like macros ($state, $effect, $derived)
    componentPath.traverse({
      CallExpression(p) {
        if (t.isIdentifier(p.node.callee)) {
          const name = p.node.callee.name;
          if (name === "$state") {
            p.get("callee").replaceWith(getImport("signal", "@preact/signals"));
          } else if (name === "$effect") {
            p.get("callee").replaceWith(getImport("effect", "@preact/signals"));
          } else if (name === "$derived") {
            p.get("callee").replaceWith(getImport("computed", "@preact/signals"));
          }
        }
      }
    }, state);


    const { statements, rootId, signals } = transformJSX(jsxNode, t, state, getImport);
    const componentInfo = state.components.get(name);
    const allSignals = new Set([...signals, ...(componentInfo?.observedAttributes || [])]);

    if (isRenderFn) {
      // ... (rest of render logic remains same)
      // Transform to export function render(root) { ... }
      const renderFn = t.functionDeclaration(
        t.identifier("render"),
        [t.identifier("root")],
        t.blockStatement([
          ...originalStatements,
          ...statements,
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier("root"), t.identifier("appendChild")),
              [rootId]
            )
          )
        ])
      );
      
      const parent = componentPath.parentPath;
      if (parent.isExportDefaultDeclaration()) {
        parent.replaceWith(t.exportNamedDeclaration(renderFn));
      } else {
        componentPath.replaceWith(renderFn);
      }
    } else {
      // Transform to Web Component Class
      const tagName = "waf-" + name.toLowerCase();
      const observedAttributes = Array.from(allSignals);
      const signalId = getImport("signal", "@preact/signals");
      const createPropsProxyId = getImport("createPropsProxy", "/framework/runtime/props.js");
      const classId = t.identifier(name + "Element");

      const classDecl = t.classDeclaration(
        classId,
        t.identifier("HTMLElement"),
        t.classBody([
          t.classProperty(t.identifier("observedAttributes"), t.arrayExpression(observedAttributes.map(s => t.stringLiteral(s))), null, null, false, true),
          // Add getters and setters for each observed attribute
          ...observedAttributes.map(s => t.classMethod(
            "set",
            t.identifier(s),
            [t.identifier("val")],
            t.blockStatement([
              t.expressionStatement(t.assignmentExpression(
                "=",
                t.memberExpression(
                  t.memberExpression(
                    t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")),
                    t.stringLiteral(s),
                    true
                  ),
                  t.identifier("value")
                ),
                t.identifier("val")
              ))
            ])
          )),
          ...observedAttributes.map(s => t.classMethod(
            "get",
            t.identifier(s),
            [],
            t.blockStatement([
              t.returnStatement(t.memberExpression(
                t.memberExpression(
                  t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")),
                  t.stringLiteral(s),
                  true
                ),
                t.identifier("value")
              ))
            ])
          )),
          t.classMethod("constructor", t.identifier("constructor"), [], t.blockStatement([
            t.expressionStatement(t.callExpression(t.super(), [])),
            t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")), t.objectExpression(
              observedAttributes.map(s => t.objectProperty(t.identifier(s), t.callExpression(signalId, [t.nullLiteral()])))
            )))
          ])),
          t.classMethod("method", t.identifier("attributeChangedCallback"), [t.identifier("name"), t.identifier("_"), t.identifier("value")], t.blockStatement([
            t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")), t.identifier("name"), true), t.identifier("value")), t.identifier("value")))
          ])),
          t.classMethod("method", t.identifier("connectedCallback"), [], t.blockStatement([
            t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.thisExpression(), t.identifier("_onCleanups")), t.arrayExpression([]))),
            t.variableDeclaration("const", [t.variableDeclarator(t.identifier("props"), t.callExpression(createPropsProxyId, [t.thisExpression()]))]),
            
            // Inject destructuring if present
            ...(componentInfo?.observedAttributes?.size > 0 ? [
              t.variableDeclaration("const", [
                t.variableDeclarator(
                  t.objectPattern(Array.from(componentInfo.observedAttributes).map(s => 
                    t.objectProperty(t.identifier(s), t.identifier(s), false, true)
                  )),
                  t.identifier("props")
                )
              ])
            ] : []),

            ...originalStatements.map(stmt => {
              if (t.isExpressionStatement(stmt) && t.isCallExpression(stmt.expression)) {
                const call = stmt.expression;
                if (t.isIdentifier(call.callee, { name: "onCleanup" })) {
                  return t.expressionStatement(t.callExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier("_onCleanups")), t.identifier("push")), [call.arguments[0]]));
                }
                if (t.isIdentifier(call.callee, { name: "onMount" })) return t.emptyStatement();
              }
              return stmt;
            }),
            ...statements,
            t.whileStatement(t.memberExpression(t.thisExpression(), t.identifier("firstChild")), t.expressionStatement(t.callExpression(t.memberExpression(rootId, t.identifier("appendChild")), [t.memberExpression(t.thisExpression(), t.identifier("firstChild"))]))),
            t.expressionStatement(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier("appendChild")), [rootId])),
            ...originalStatements.filter(stmt => t.isExpressionStatement(stmt) && t.isCallExpression(stmt.expression) && t.isIdentifier(stmt.expression.callee, { name: "onMount" }))
              .map(stmt => t.expressionStatement(t.callExpression(stmt.expression.arguments[0], [])))
          ])),
          t.classMethod("method", t.identifier("disconnectedCallback"), [], t.blockStatement([
            t.expressionStatement(t.callExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier("_onCleanups")), t.identifier("forEach")), [t.arrowFunctionExpression([t.identifier("fn")], t.callExpression(t.identifier("fn"), []))]))
          ]))
        ])
      );
      
      const parent = componentPath.parentPath;
      const targetPath = parent.isExportDefaultDeclaration() ? parent : componentPath;
      targetPath.insertBefore(classDecl);
      targetPath.insertBefore(t.expressionStatement(
        t.callExpression(
          t.memberExpression(t.identifier("customElements"), t.identifier("define")),
          [t.stringLiteral(tagName), classId]
        )
      ));

      if (parent.isExportDefaultDeclaration()) {
        parent.replaceWith(t.exportDefaultDeclaration(classId));
      } else {
        componentPath.remove(); // The classDecl is already inserted before
      }
    }
  }

  function transformJSX(node, t, state, getImport) {
    const statements = [];
    const signals = new Set();
    let counter = 0;
    const nextId = (prefix = "el") => t.identifier(prefix + (counter++));
    const toKebabCase = (str) => str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

    function processNode(n) {
      if (t.isJSXElement(n)) {
        const tagName = n.openingElement.name.name;
        const isComponent = /^[A-Z]/.test(tagName);
        const elId = nextId();

        if (isComponent) {
          const componentTagName = "waf-" + tagName.toLowerCase();
          statements.push(t.variableDeclaration("const", [
            t.variableDeclarator(elId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createElement")), [t.stringLiteral(componentTagName)]))
          ]));
          
          n.openingElement.attributes.forEach(attr => {
            const name = attr.name.name;
            const value = attr.value;
            statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(elId, t.identifier(name === "class" || name === "className" ? "className" : name)), t.isJSXExpressionContainer(value) ? value.expression : value)));
          });
          
          n.children.forEach(child => {
            const childId = processNode(child);
            if (childId) statements.push(t.expressionStatement(t.callExpression(t.memberExpression(elId, t.identifier("appendChild")), [childId])));
          });
          return elId;
        }

        statements.push(t.variableDeclaration("const", [
          t.variableDeclarator(elId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createElement")), [t.stringLiteral(tagName)]))
        ]));

        n.openingElement.attributes.forEach(attr => {
          const originalName = attr.name.name;
          const name = originalName.toLowerCase();
          const value = attr.value;

          if (name.startsWith("on")) {
            if (t.isJSXExpressionContainer(value) && t.isJSXEmptyExpression(value.expression)) return;
            statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(elId, t.identifier(name)), t.isJSXExpressionContainer(value) ? value.expression : value)));
          } else if (t.isJSXExpressionContainer(value)) {
            if (t.isJSXEmptyExpression(value.expression)) return;
            if (t.isMemberExpression(value.expression) && t.isIdentifier(value.expression.object, { name: "props" })) signals.add(value.expression.property.name);
            
            const effectId = getImport("effect", "@preact/signals");
            const attrProp = (name === "class" || name === "classname") ? "className" : name;
            const isStyle = attrProp === "style";
            const isProperty = ["className", "style", "value", "checked", "id", "title", "href", "src"].includes(attrProp);
            
            statements.push(t.expressionStatement(t.callExpression(effectId, [t.arrowFunctionExpression([], 
              isStyle ? t.callExpression(t.memberExpression(t.identifier("Object"), t.identifier("assign")), [t.memberExpression(elId, t.identifier("style")), value.expression])
              : isProperty ? t.assignmentExpression("=", t.memberExpression(elId, t.identifier(attrProp)), value.expression)
              : t.callExpression(t.memberExpression(elId, t.identifier("setAttribute")), [t.stringLiteral(toKebabCase(originalName)), value.expression])
            )])));
          } else {
            const attrProp = (name === "class" || name === "classname") ? "className" : name;
            if (attrProp === "className") {
              statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(elId, t.identifier("className")), value)));
            } else {
              statements.push(t.expressionStatement(t.callExpression(t.memberExpression(elId, t.identifier("setAttribute")), [t.stringLiteral(toKebabCase(originalName)), value])));
            }
          }
        });

        n.children.forEach(child => {
          const childId = processNode(child);
          if (childId) statements.push(t.expressionStatement(t.callExpression(t.memberExpression(elId, t.identifier("appendChild")), [childId])));
        });
        return elId;
      } else if (t.isJSXText(n)) {
        const text = n.value.replace(/\n\s*/g, "");
        if (!text) return null;
        const textId = nextId("text");
        statements.push(t.variableDeclaration("const", [t.variableDeclarator(textId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createTextNode")), [t.stringLiteral(text)]))]));
        return textId;
      } else if (t.isJSXExpressionContainer(n)) {
        if (t.isJSXEmptyExpression(n.expression)) return null;
        const textId = nextId("text");
        const effectId = getImport("effect", "@preact/signals");
        statements.push(t.variableDeclaration("const", [t.variableDeclarator(textId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createTextNode")), [t.stringLiteral("")]))]));
        statements.push(t.expressionStatement(t.callExpression(effectId, [t.arrowFunctionExpression([], t.assignmentExpression("=", t.memberExpression(textId, t.identifier("textContent")), n.expression))])));
        if (t.isMemberExpression(n.expression) && t.isIdentifier(n.expression.object, { name: "props" })) signals.add(n.expression.property.name);
        return textId;
      }
    }
    const rootId = processNode(node);
    return { statements, rootId, signals };
  }
};
