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
          const pagePatterns = ["page.jsx", "page.tsx", "layout.jsx", "layout.tsx", "404.jsx", "404.tsx"];
          state.isPageFile = pagePatterns.some(p => filename.endsWith(p));
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
          // Check if this function actually uses JSX. If not, it's just a regular function, not a component.
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
      },

      CallExpression(path, state) {
        if (t.isIdentifier(path.node.callee)) {
          const name = path.node.callee.name;
          const getImport = (importName, source) => {
            const key = `${importName}:${source}`;
            if (!state.importsNeeded.has(key)) {
              state.importsNeeded.set(key, addNamed(path, importName, source));
            }
            return state.importsNeeded.get(key);
          };

          if (name === "$state" || name === "$derived" || name === "$ref") {
            // Track this variable as a state variable in the current scope
            const parent = path.findParent(p => p.isVariableDeclarator());
            if (parent && t.isIdentifier(parent.node.id)) {
              if (!state.stateVars) state.stateVars = new Set();
              state.stateVars.add(parent.node.id.name);
            }
            if (name === "$state") {
              path.get("callee").replaceWith(getImport("signal", "@preact/signals-core"));
            } else if (name === "$derived") {
              path.get("callee").replaceWith(getImport("computed", "@preact/signals-core"));
            } else if (name === "$ref") {
              // Track this variable as a ref variable
              const parent = path.findParent(p => p.isVariableDeclarator());
              if (parent && t.isIdentifier(parent.node.id)) {
                if (!state.refVars) state.refVars = new Set();
                state.refVars.add(parent.node.id.name);
                if (!state.stateVars) state.stateVars = new Set();
                state.stateVars.add(parent.node.id.name);
              }
              path.get("callee").replaceWith(getImport("signal", "@preact/signals-core"));
            }
          } else if (name === "$effect") {
            path.get("callee").replaceWith(getImport("effect", "@preact/signals-core"));
          } else if (name === "$expose") {
            // $expose({ a, b }) -> Object.assign(this, { a, b })
            path.get("callee").replaceWith(t.memberExpression(t.identifier("Object"), t.identifier("assign")));
            path.node.arguments.unshift(t.thisExpression());
          } else if (name === "onMount") {
            path.get("callee").replaceWith(getImport("onMount", "/framework/runtime/lifecycle.js"));
          } else if (name === "onCleanup") {
            path.get("callee").replaceWith(getImport("onCleanup", "/framework/runtime/lifecycle.js"));
          } else if (name === "$renderDynamic") {
            path.get("callee").replaceWith(getImport("renderDynamic", "/framework/runtime/dom.js"));
          }
        }
      },

      Identifier(path, state) {
        if (!state.stateVars || !state.stateVars.has(path.node.name)) return;
        if (path.node._processed) return;
        
        // Strictly forbid manual .value access on $state variables
        if (path.parentPath.isMemberExpression() && !path.parentPath.node.computed) {
          if (t.isIdentifier(path.parentPath.node.property, { name: "value" })) {
            throw path.parentPath.buildCodeFrameError(
              `Manual .value access is forbidden for variables declared with $state. The WAF compiler handles this automatically. Remove the .value from '${path.node.name}.value'.`
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

  function handleJSXVisitor(path, state, t) {
    if (path.node._processed) return;
    const getImport = (importName, source) => {
      const key = `${importName}:${source}`;
      if (!state.importsNeeded.has(key)) {
        state.importsNeeded.set(key, addNamed(path, importName, source));
      }
      return state.importsNeeded.get(key);
    };

    const { statements, rootId, signals } = transformJSX(path.node, t, state, getImport, path);

    // Propagate signals to parent component for observedAttributes
    const parentFunc = path.findParent(p => 
      p.isFunctionDeclaration() && (
        /^[A-Z]/.test(p.node.id?.name) || 
        (p.parentPath.isExportDefaultDeclaration() && state.isPageFile)
      )
    );

    if (parentFunc) {
      let compName = parentFunc.node.id?.name;
      if (!compName && parentFunc.parentPath.isExportDefaultDeclaration()) {
        compName = "_default";
      }
      if (compName) {
        const info = state.components.get(compName);
        if (info) {
          if (!info.observedAttributes) info.observedAttributes = new Set();
          signals.forEach(s => info.observedAttributes.add(s));
        }
      }
    }

    const iife = t.callExpression(t.arrowFunctionExpression([], t.blockStatement([
      ...statements,
      t.returnStatement(rootId)
    ])), []);
    iife._processed = true;
    path.replaceWith(iife);
  }

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
      if (t.isReturnStatement(stmt)) {
        jsxNode = stmt.argument;
      } else {
        originalStatements.push(stmt);
      }
    });

    if (!jsxNode) return;

    const res = transformJSX(jsxNode, t, state, getImport, componentPath);
    let statements = res.statements;
    let rootId = res.rootId;
    let signals = res.signals;

    // Capture the root element in a variable to avoid re-evaluating the IIFE if it is one
    const rootVar = t.identifier("rootElement");
    statements.push(t.variableDeclaration("const", [t.variableDeclarator(rootVar, rootId)]));
    rootId = rootVar;



    const componentInfo = state.components.get(name);
    
    // Prop Transformation: If the component uses destructuring in params, 
    // we convert it to use `props` and replace usages to maintain reactivity.
    if (!isRenderFn) {
      const propsNode = node.params[0];
      if (t.isObjectPattern(propsNode)) {
        const propNames = new Set();
        propsNode.properties.forEach(prop => {
          if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
            propNames.add(prop.key.name);
          }
        });

        node.params[0] = t.identifier("props");

        const replaceProps = (node) => {
          if (!node || typeof node !== "object") return;

          if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) {
              const child = node[i];
              if (t.isIdentifier(child) && propNames.has(child.name)) {
                node[i] = t.memberExpression(t.identifier("props"), t.identifier(child.name));
              } else {
                replaceProps(child);
              }
            }
            return;
          }

          for (const key in node) {
            const child = node[key];
            if (t.isIdentifier(child) && propNames.has(child.name)) {
              // Only replace if it's NOT a property key in an object or member expression
              if (t.isObjectProperty(node) && key === "key" && !node.computed) continue;
              if (t.isMemberExpression(node) && key === "property" && !node.computed) continue;
              if (t.isClassMethod(node) && key === "key") continue;
              if (t.isJSXAttribute(node) && key === "name") continue;
              
              node[key] = t.memberExpression(t.identifier("props"), t.identifier(child.name));
            } else {
              replaceProps(child);
            }
          }
        };

        replaceProps(originalStatements);
        replaceProps(statements);
      }
    }



    const allSignals = new Set([...signals, ...(componentInfo?.observedAttributes || [])]);


    if (isRenderFn) {
      // ... (rest of render logic remains same)
      // Transform to export function render(root) { ... }
      const renderFn = t.functionDeclaration(
        t.identifier("render"),
        [t.identifier("root"), t.identifier("props")],
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
      const signalId = getImport("signal", "@preact/signals-core");
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
              )),
              // Sync back to native attributes for class and style
              ...(s === "className" ? [
                t.expressionStatement(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier("setAttribute")), [t.stringLiteral("class"), t.identifier("val")]))
              ] : s === "style" ? [
                t.ifStatement(
                  t.logicalExpression("&&", t.identifier("val"), t.binaryExpression("===", t.unaryExpression("typeof", t.identifier("val"), false), t.stringLiteral("object"))),
                  t.expressionStatement(t.callExpression(t.memberExpression(t.identifier("Object"), t.identifier("assign")), [t.memberExpression(t.thisExpression(), t.identifier("style")), t.identifier("val")]))
                )
              ] : [])
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
            t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.thisExpression(), t.identifier("_onMounts")), t.arrayExpression([]))),
            t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.thisExpression(), t.identifier("_onCleanups")), t.arrayExpression([]))),
            t.variableDeclaration("const", [t.variableDeclarator(t.identifier("props"), t.callExpression(createPropsProxyId, [t.thisExpression()]))]),
            
            // Wrap setup in withInstance(this, () => { ... })
            t.expressionStatement(t.callExpression(getImport("withInstance", "/framework/runtime/lifecycle.js"), [
              t.thisExpression(),
              t.arrowFunctionExpression([], t.blockStatement([
                ...originalStatements,
                ...statements,

                t.whileStatement(t.memberExpression(t.thisExpression(), t.identifier("firstChild")), t.expressionStatement(t.callExpression(t.memberExpression(rootId, t.identifier("appendChild")), [t.memberExpression(t.thisExpression(), t.identifier("firstChild"))]))),
                t.expressionStatement(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier("appendChild")), [rootId]))
              ]))
            ])),
            // Run onMounts
            t.expressionStatement(t.callExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier("_onMounts")), t.identifier("forEach")), [t.arrowFunctionExpression([t.identifier("fn")], t.callExpression(t.identifier("fn"), []))]))
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

  function transformJSX(node, t, state, getImport, path) {
    if (node._processed) return { statements: [], rootId: node, signals: new Set() };
    node._processed = true;

    const statements = [];

    const signals = new Set();
    let counter = 0;
    const nextId = (prefix = "el") => t.identifier(prefix + (counter++));
    const toKebabCase = (str) => str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

    function collectSignals(exprNode) {
      if (!exprNode || typeof exprNode !== "object") return;
      if (Array.isArray(exprNode)) {
        exprNode.forEach(collectSignals);
        return;
      }
      if (t.isMemberExpression(exprNode) && t.isIdentifier(exprNode.object, { name: "props" }) && t.isIdentifier(exprNode.property)) {
        signals.add(exprNode.property.name);
      }
      Object.keys(exprNode).forEach(key => {
        if (key === "property" && t.isMemberExpression(exprNode) && !exprNode.computed) return;
        collectSignals(exprNode[key]);
      });
    }

    function processNode(n, parentElId) {
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
            const targetProp = name === "class" || name === "className" ? "className" : name;

            if (t.isJSXExpressionContainer(value)) {
              if (name === "ref" && t.isIdentifier(value.expression) && state.refVars?.has(value.expression.name)) {
                const refName = value.expression.name;
                const innerId = t.identifier(refName);
                innerId._processed = true;
                statements.push(t.expressionStatement(t.assignmentExpression(
                  "=",
                  t.memberExpression(innerId, t.identifier("value")),
                  elId
                )));
                return;
              }
              collectSignals(value.expression);
              const effectId = getImport("effect", "@preact/signals-core");
              statements.push(t.expressionStatement(t.callExpression(effectId, [
                t.arrowFunctionExpression([], t.assignmentExpression("=", t.memberExpression(elId, t.identifier(targetProp)), value.expression))
              ])));
            } else {
              statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(elId, t.identifier(targetProp)), value)));
            }
          });

          
          n.children.forEach(child => {
            const childId = processNode(child, elId);
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
            
            if (originalName === "ref" && t.isIdentifier(value.expression) && state.refVars?.has(value.expression.name)) {
              const refName = value.expression.name;
              const innerId = t.identifier(refName);
              innerId._processed = true;
              statements.push(t.expressionStatement(t.assignmentExpression(
                "=",
                t.memberExpression(innerId, t.identifier("value")),
                elId
              )));
              return;
            }

            collectSignals(value.expression);
            
            const effectId = getImport("effect", "@preact/signals-core");
            const attrProp = (name === "class" || name === "classname") ? "className" : name;
            const isStyle = attrProp === "style";
            const isProperty = ["className", "style", "value", "checked", "id", "title", "href", "src", "key"].includes(attrProp);
            
            if (attrProp === "key") {
              statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(elId, t.identifier("_key")), value.expression)));
            } else {
              statements.push(t.expressionStatement(t.callExpression(effectId, [t.arrowFunctionExpression([], 
                isStyle ? t.callExpression(t.memberExpression(t.identifier("Object"), t.identifier("assign")), [t.memberExpression(elId, t.identifier("style")), value.expression])
                : isProperty ? t.assignmentExpression("=", t.memberExpression(elId, t.identifier(attrProp)), value.expression)
                : t.callExpression(t.memberExpression(elId, t.identifier("setAttribute")), [t.stringLiteral(toKebabCase(originalName)), value.expression])
              )])));
            }
          } else {
            const attrProp = (name === "class" || name === "classname") ? "className" : name;
            const isProperty = ["className", "style", "value", "checked", "id", "title", "href", "src", "key"].includes(attrProp);
            
            if (isProperty) {
              statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(elId, t.identifier(attrProp === "key" ? "_key" : attrProp)), value)));
            } else {
              statements.push(t.expressionStatement(t.callExpression(t.memberExpression(elId, t.identifier("setAttribute")), [t.stringLiteral(toKebabCase(originalName)), value])));
            }
          }
        });

        n.children.forEach(child => {
          const childId = processNode(child, elId);
          if (childId) statements.push(t.expressionStatement(t.callExpression(t.memberExpression(elId, t.identifier("appendChild")), [childId])));
        });
        return elId;
      } else if (t.isJSXText(n)) {
        const text = n.value.replace(/\n\s*/g, "");
        if (!text) return null;
        const textId = nextId("text");
        statements.push(t.variableDeclaration("const", [t.variableDeclarator(textId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createTextNode")), [t.stringLiteral(text)]))]));
        return textId;
      } else if (t.isJSXFragment(n)) {
        const fragId = nextId("frag");
        statements.push(t.variableDeclaration("const", [t.variableDeclarator(fragId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createDocumentFragment")), []))]));
        n.children.forEach(child => {
          const childId = processNode(child, fragId);
          if (childId) statements.push(t.expressionStatement(t.callExpression(t.memberExpression(fragId, t.identifier("appendChild")), [childId])));
        });
        return fragId;
      } else if (t.isJSXExpressionContainer(n)) {
        if (t.isJSXEmptyExpression(n.expression)) return null;
        
        collectSignals(n.expression);

        // Recursive helper to transform nested JSX elements into imperative IIFEs
        const transformNestedJSX = (exprNode) => {
          if (!exprNode || typeof exprNode !== "object") return;
          if (Array.isArray(exprNode)) {
            exprNode.forEach(transformNestedJSX);
            return;
          }
          
          Object.keys(exprNode).forEach(key => {
            const child = exprNode[key];
            if (t.isJSXElement(child) || t.isJSXFragment(child)) {
              if (child._processed) return;
              const { statements: innerStatements, rootId: innerRootId, signals: innerSignals } = transformJSX(child, t, state, getImport, path);
              innerSignals.forEach(s => signals.add(s));
              exprNode[key] = t.callExpression(t.arrowFunctionExpression([], t.blockStatement([
                ...innerStatements,
                t.returnStatement(innerRootId)
              ])), []);
              exprNode[key]._processed = true;
            } else {
              transformNestedJSX(child);
            }
          });
        };

        transformNestedJSX(n.expression);


        const renderDynamicId = getImport("renderDynamic", "/framework/runtime/dom.js");
        statements.push(t.expressionStatement(t.callExpression(renderDynamicId, [
          parentElId,
          t.arrowFunctionExpression([], n.expression)
        ])));

        return null;
      } else if (t.isExpression(n)) {
        return n;
      }
    }


    const rootId = processNode(node, t.identifier("root"));
    return { statements, rootId, signals };
  }

};
