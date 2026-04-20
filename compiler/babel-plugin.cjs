const { addNamed } = require("@babel/helper-module-imports");
const path = require("path");

module.exports = function (babel) {
  const { types: t } = babel;

  return {
    name: "waf-compiler",
    visitor: {
      Program: {
        enter(p, state) {
          state.jsxElements = [];
          state.importsNeeded = new Map();
          state.importSources = new Map(); // identifier -> source file
          
          const filename = state.filename || "";
          if (filename.endsWith(".wc.jsx") || filename.endsWith(".wc.tsx")) {
            state.fileType = "component";
          } else if (filename.endsWith(".jsx") || filename.endsWith(".tsx")) {
            state.fileType = "page";
          } else {
            state.fileType = "utility";
          }
        },
      },

      ImportDeclaration(path, state) {
        const source = path.node.source.value;
        path.node.specifiers.forEach(spec => {
          if (t.isImportDefaultSpecifier(spec) || t.isImportSpecifier(spec)) {
            state.importSources.set(spec.local.name, source);
          }
        });
      },

      ExportDefaultDeclaration(path, state) {
        if (state.fileType === "utility") return;

        const declaration = path.node.declaration;
        if (t.isFunctionDeclaration(declaration)) {
          const componentName = declaration.id.name;
          const body = declaration.body;

          // Helper to get or add imports
          const getImport = (name, source) => {
            const key = `${name}:${source}`;
            if (!state.importsNeeded.has(key)) {
              state.importsNeeded.set(key, addNamed(path, name, source));
            }
            return state.importsNeeded.get(key);
          };

          // Find the return statement with JSX and get original statements
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

          // Process JSX to get DOM operations
          const { statements, rootId, signals } = transformJSX(jsxNode, t, state, getImport);

          if (state.fileType === "page") {
            const renderFn = t.exportNamedDeclaration(
              t.functionDeclaration(
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
              )
            );
            path.replaceWith(renderFn);
          } else {
            const tagName = "waf-" + componentName.toLowerCase();
            const observedAttributes = Array.from(signals);

            const signalId = getImport("signal", "@preact/signals");
            const createPropsProxyId = getImport("createPropsProxy", "/framework/runtime/props.js");

            const classId = t.identifier(componentName + "Element");
            
            const classDecl = t.classDeclaration(
              classId,
              t.identifier("HTMLElement"),
              t.classBody([
                t.classProperty(
                  t.identifier("observedAttributes"),
                  t.arrayExpression(observedAttributes.map(s => t.stringLiteral(s))),
                  null,
                  null,
                  false,
                  true
                ),
                t.classMethod(
                  "constructor",
                  t.identifier("constructor"),
                  [],
                  t.blockStatement([
                    t.expressionStatement(t.callExpression(t.super(), [])),
                    t.expressionStatement(
                      t.assignmentExpression(
                        "=",
                        t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")),
                        t.objectExpression(
                          observedAttributes.map(s => 
                            t.objectProperty(
                              t.identifier(s),
                              t.callExpression(signalId, [t.nullLiteral()])
                            )
                          )
                        )
                      )
                    )
                  ])
                ),
                t.classMethod(
                  "method",
                  t.identifier("attributeChangedCallback"),
                  [t.identifier("name"), t.identifier("_"), t.identifier("value")],
                  t.blockStatement([
                    t.expressionStatement(
                      t.assignmentExpression(
                        "=",
                        t.memberExpression(
                          t.memberExpression(
                            t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")),
                            t.identifier("name"),
                            true
                          ),
                          t.identifier("value")
                        ),
                        t.identifier("value")
                      )
                    )
                  ])
                ),
                t.classMethod(
                  "method",
                  t.identifier("connectedCallback"),
                  [],
                  t.blockStatement([
                    t.variableDeclaration("const", [
                      t.variableDeclarator(
                        t.identifier("props"),
                        t.callExpression(createPropsProxyId, [t.thisExpression()])
                      )
                    ]),
                    ...originalStatements,
                    ...statements,
                    t.whileStatement(
                      t.memberExpression(t.thisExpression(), t.identifier("firstChild")),
                      t.expressionStatement(
                        t.callExpression(
                          t.memberExpression(rootId, t.identifier("appendChild")),
                          [t.memberExpression(t.thisExpression(), t.identifier("firstChild"))]
                        )
                      )
                    ),
                    t.expressionStatement(
                      t.callExpression(
                        t.memberExpression(t.thisExpression(), t.identifier("appendChild")),
                        [rootId]
                      )
                    )
                  ])
                )
              ])
            );

            path.insertBefore(classDecl);
            path.insertBefore(
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(t.identifier("customElements"), t.identifier("define")),
                  [t.stringLiteral(tagName), classId]
                )
              )
            );
            path.replaceWith(t.exportDefaultDeclaration(classId));
          }
        }
      }
    }
  };

  function transformJSX(node, t, state, getImport) {
    const statements = [];
    const signals = new Set();
    let counter = 0;

    function nextId(prefix = "el") {
      return t.identifier(prefix + (counter++));
    }

    function processNode(n) {
      if (t.isJSXElement(n)) {
        const tagName = n.openingElement.name.name;
        const isComponent = /^[A-Z]/.test(tagName);
        const elId = nextId();

        if (isComponent) {
          // Enforcement: No .jsx as component
          const source = state.importSources.get(tagName);
          if (source && (source.endsWith(".jsx") || source.endsWith(".tsx")) && !source.includes(".wc.")) {
             throw new Error(`❌ [WAF Compiler] Error in ${state.filename}: Cannot use "${tagName}" as a component because it is a Page file (.jsx / .tsx). Only Web Components (.wc.jsx / .wc.tsx) can be used as JSX tags.`);
          }

          const componentTagName = "waf-" + tagName.toLowerCase();
          statements.push(
            t.variableDeclaration("const", [
              t.variableDeclarator(
                elId,
                t.callExpression(
                  t.memberExpression(t.identifier("document"), t.identifier("createElement")),
                  [t.stringLiteral(componentTagName)]
                )
              )
            ])
          );
          n.openingElement.attributes.forEach(attr => {
            const name = attr.name.name;
            const value = attr.value;
            if (t.isJSXExpressionContainer(value)) {
              statements.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(elId, t.identifier(name)),
                    value.expression
                  )
                )
              );
            } else {
              statements.push(
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(elId, t.identifier("setAttribute")),
                    [t.stringLiteral(name), value]
                  )
                )
              );
            }
          });
        } else {
          statements.push(
            t.variableDeclaration("const", [
              t.variableDeclarator(
                elId,
                t.callExpression(
                  t.memberExpression(t.identifier("document"), t.identifier("createElement")),
                  [t.stringLiteral(tagName)]
                )
              )
            ])
          );

          n.openingElement.attributes.forEach(attr => {
            const name = attr.name.name.toLowerCase();
            const value = attr.value;

            if (name.startsWith("on")) {
              statements.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(elId, t.identifier(name)),
                    t.isJSXExpressionContainer(value) ? value.expression : value
                  )
                )
              );
            } else if (t.isJSXExpressionContainer(value)) {
              if (t.isMemberExpression(value.expression) && t.isIdentifier(value.expression.object, { name: "props" })) {
                signals.add(value.expression.property.name);
              }
              const effectId = getImport("effect", "@preact/signals");
              statements.push(
                t.expressionStatement(
                  t.callExpression(effectId, [
                    t.arrowFunctionExpression(
                      [],
                      t.assignmentExpression(
                        "=",
                        t.memberExpression(elId, t.identifier(name)),
                        value.expression
                      )
                    )
                  ])
                )
              );
            } else {
              statements.push(
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(elId, t.identifier(name)),
                    value
                  )
                )
              );
            }
          });
        }

        n.children.forEach(child => {
          const childId = processNode(child);
          if (childId) {
            statements.push(
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(elId, t.identifier("appendChild")),
                  [childId]
                )
              )
            );
          }
        });

        return elId;
      } else if (t.isJSXText(n)) {
        const text = n.value.trim();
        if (!text) return null;
        const textId = nextId("text");
        statements.push(
          t.variableDeclaration("const", [
            t.variableDeclarator(
              textId,
              t.callExpression(
                t.memberExpression(t.identifier("document"), t.identifier("createTextNode")),
                [t.stringLiteral(text)]
              )
            )
          ])
        );
        return textId;
      } else if (t.isJSXExpressionContainer(n)) {
        const textId = nextId("text");
        const effectId = getImport("effect", "@preact/signals");
        statements.push(
          t.variableDeclaration("const", [
            t.variableDeclarator(
              textId,
              t.callExpression(
                t.memberExpression(t.identifier("document"), t.identifier("createTextNode")),
                [t.stringLiteral("")]
              )
            )
          ])
        );
        statements.push(
          t.expressionStatement(
            t.callExpression(effectId, [
              t.arrowFunctionExpression(
                [],
                t.assignmentExpression(
                  "=",
                  t.memberExpression(textId, t.identifier("textContent")),
                  n.expression
                )
              )
            ])
          )
        );

        if (t.isMemberExpression(n.expression) && t.isIdentifier(n.expression.object, { name: "props" })) {
          signals.add(n.expression.property.name);
        }

        return textId;
      }
    }

    const rootId = processNode(node);
    return { statements, rootId, signals };
  }
};
