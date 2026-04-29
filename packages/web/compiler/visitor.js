import { addNamed } from "@babel/helper-module-imports";
import { SVG_TAGS, SVG_CAMEL_CASE, IS_PROPERTY, STANDARD_TAGS } from "./constants.js";
import { getMemberName, getImportHelper, createIdGenerator } from "./helpers.js";

export function handleJSXVisitor(path, state, t) {
  if (path.node._processed) return;
  const getImport = getImportHelper(t, path, state);

  const { statements, rootId, signals } = transformJSX(path.node, t, state, getImport, path);

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

export function transformComponent(componentPath, name, isRenderFn, t, state) {
  const node = componentPath.node;
  const body = node.body;
  const getImport = getImportHelper(t, componentPath, state);

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

  const rootVar = t.identifier("rootElement");
  statements.push(t.variableDeclaration("const", [t.variableDeclarator(rootVar, rootId)]));
  rootId = rootVar;

  const componentInfo = state.components.get(name);
  
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
    const renderFn = t.functionDeclaration(
      t.identifier("render"),
      [t.identifier("root"), t.identifier("props")],
      t.blockStatement([
        ...(t.isObjectPattern(node.params[0]) ? [t.variableDeclaration("const", [t.variableDeclarator(node.params[0], t.identifier("props"))])] : []),
        ...originalStatements,
        ...statements,
        t.expressionStatement(t.callExpression(t.memberExpression(t.identifier("root"), t.identifier("appendChild")), [rootId]))
      ])
    );
    
    const parent = componentPath.parentPath;
    if (parent.isExportDefaultDeclaration()) {
      parent.replaceWith(t.exportNamedDeclaration(renderFn));
    } else {
      componentPath.replaceWith(renderFn);
    }
  } else {
    const tagName = "web-" + name.toLowerCase();
    const observedAttributes = Array.from(allSignals);
    const signalId = getImport("signal", state.runtimeSource);
    const createPropsProxyId = getImport("createPropsProxy", state.runtimeSource);
    const classId = t.identifier(name + "Element");

    const classDecl = t.classDeclaration(
      classId,
      t.identifier("HTMLElement"),
      t.classBody([
        t.classProperty(t.identifier("observedAttributes"), t.arrayExpression(observedAttributes.map(s => t.stringLiteral(s))), null, null, false, true),
        ...observedAttributes.map(s => t.classMethod(
          "set",
          t.identifier(s),
          [t.identifier("val")],
          t.blockStatement([
            t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")), t.stringLiteral(s), true), t.identifier("value")), t.identifier("val"))),
            ...(s === "className" ? [t.expressionStatement(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier("setAttribute")), [t.stringLiteral("class"), t.identifier("val")]))] : s === "style" ? [t.ifStatement(t.logicalExpression("&&", t.identifier("val"), t.binaryExpression("===", t.unaryExpression("typeof", t.identifier("val"), false), t.stringLiteral("object"))), t.expressionStatement(t.callExpression(t.memberExpression(t.identifier("Object"), t.identifier("assign")), [t.memberExpression(t.thisExpression(), t.identifier("style")), t.identifier("val")])))] : [])
          ])
        )),
        ...observedAttributes.map(s => t.classMethod("get", t.identifier(s), [], t.blockStatement([t.returnStatement(t.memberExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")), t.stringLiteral(s), true), t.identifier("value")))]))),
        t.classMethod("constructor", t.identifier("constructor"), [], t.blockStatement([
          t.expressionStatement(t.callExpression(t.super(), [])),
          t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")), t.objectExpression(observedAttributes.map(s => t.objectProperty(t.identifier(s), t.callExpression(signalId, [t.nullLiteral()]))) )))
        ])),
        t.classMethod("method", t.identifier("attributeChangedCallback"), [t.identifier("name"), t.identifier("_"), t.identifier("value")], t.blockStatement([
          t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier("_propsSignals")), t.identifier("name"), true), t.identifier("value")), t.identifier("value")))
        ])),
        t.classMethod("method", t.identifier("connectedCallback"), [], t.blockStatement([
          t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.thisExpression(), t.identifier("_onMounts")), t.arrayExpression([]))),
          t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.thisExpression(), t.identifier("_onCleanups")), t.arrayExpression([]))),
          t.variableDeclaration("const", [t.variableDeclarator(t.identifier("props"), t.callExpression(createPropsProxyId, [t.thisExpression()]))]),
          t.expressionStatement(t.assignmentExpression("=", t.memberExpression(t.thisExpression(), t.identifier("_children")), t.callExpression(t.memberExpression(t.identifier("Array"), t.identifier("from")), [t.memberExpression(t.thisExpression(), t.identifier("childNodes"))]))),
          t.whileStatement(t.memberExpression(t.thisExpression(), t.identifier("firstChild")), t.expressionStatement(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier("removeChild")), [t.memberExpression(t.thisExpression(), t.identifier("firstChild"))]))),
          t.expressionStatement(t.callExpression(getImport("withInstance", state.runtimeSource), [t.thisExpression(), t.arrowFunctionExpression([], t.blockStatement([...originalStatements, ...statements, t.expressionStatement(t.callExpression(t.memberExpression(t.thisExpression(), t.identifier("appendChild")), [rootId]))]))])),
          t.expressionStatement(t.callExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier("_onMounts")), t.identifier("forEach")), [t.arrowFunctionExpression([t.identifier("fn")], t.callExpression(t.identifier("fn"), []))]))
        ])),
        t.classMethod("method", t.identifier("disconnectedCallback"), [], t.blockStatement([
          t.expressionStatement(t.callExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier("_onCleanups")), t.identifier("forEach")), [t.arrowFunctionExpression([t.identifier("fn")], t.callExpression(t.identifier("fn"), []))]))
        ]))
      ])
    );
    
    const parent = componentPath.parentPath;
    if (parent.isExportDefaultDeclaration()) {
      componentPath.parentPath.insertBefore(classDecl);
      componentPath.parentPath.insertBefore(t.expressionStatement(t.callExpression(t.memberExpression(t.identifier("customElements"), t.identifier("define")), [t.stringLiteral(tagName), classId])));
      parent.replaceWith(t.exportDefaultDeclaration(classId));
    } else if (parent.isExportNamedDeclaration()) {
      const exportedClass = t.classDeclaration(t.identifier(name), t.identifier("HTMLElement"), classDecl.body);
      parent.replaceWith(t.exportNamedDeclaration(exportedClass, []));
      parent.insertAfter(t.expressionStatement(t.callExpression(t.memberExpression(t.identifier("customElements"), t.identifier("define")), [t.stringLiteral(tagName), t.identifier(name)])));
    } else {
      componentPath.insertBefore(classDecl);
      componentPath.insertBefore(t.expressionStatement(t.callExpression(t.memberExpression(t.identifier("customElements"), t.identifier("define")), [t.stringLiteral(tagName), classId])));
      componentPath.remove();
    }
  }
}

export function transformJSX(node, t, state, getImport, path) {
  if (node._processed) return { statements: [], rootId: node, signals: new Set() };
  node._processed = true;
  const statements = [];
  const signals = new Set();
  const nextId = createIdGenerator();
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
      const tagNameNode = n.openingElement.name;
      let tagName = "";
      if (t.isJSXIdentifier(tagNameNode)) {
        tagName = tagNameNode.name;
      } else if (t.isJSXMemberExpression(tagNameNode)) {
        tagName = getMemberName(t, tagNameNode);
      }

      const isComponent = /^[A-Z]/.test(tagName) || tagName.includes(".");
      const elId = nextId(t);

      if (isComponent) {
        const binding = path.scope.getBinding(tagName);
        const isStandardTag = /^[a-z]/.test(tagName) && STANDARD_TAGS.includes(tagName.toLowerCase());
        
        let componentTagName = tagName;
        if (tagName.includes(".")) {
           componentTagName = "web-" + tagName.replace(/\./g, "-").toLowerCase();
        } else if (!isStandardTag) {
           componentTagName = "web-" + tagName.toLowerCase();
        }

        const isFunction = binding && (t.isFunctionDeclaration(binding.path.node) || t.isFunctionExpression(binding.path.node) || t.isArrowFunctionExpression(binding.path.node));
        const isImport = binding && binding.kind === "module";
        const isVariable = binding && t.isVariableDeclarator(binding.path.node);

        if (isFunction || isImport || (!binding && !isStandardTag)) {
           statements.push(t.variableDeclaration("const", [t.variableDeclarator(elId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createElement")), [t.stringLiteral(componentTagName)]))]));
        } else if (isVariable) {
           statements.push(t.variableDeclaration("const", [t.variableDeclarator(elId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createElement")), [t.identifier(tagName)]))]));
        } else {
          statements.push(t.variableDeclaration("const", [t.variableDeclarator(elId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createElement")), [t.stringLiteral(componentTagName)]))]));
        }

        n.openingElement.attributes.forEach(attr => {
          if (t.isJSXSpreadAttribute(attr)) {
            const applySpreadId = getImport("applySpread", state.runtimeSource);
            statements.push(t.expressionStatement(t.callExpression(applySpreadId, [elId, attr.argument])));
            return;
          }
          const name = attr.name.name;
          const value = attr.value || t.booleanLiteral(true);
          const targetProp = name === "class" || name === "className" ? "className" : name;

          if (t.isJSXExpressionContainer(value)) {
            if (name === "ref" && t.isIdentifier(value.expression) && state.refVars?.has(value.expression.name)) {
              const refName = value.expression.name;
              const innerId = t.identifier(refName);
              innerId._processed = true;
              statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(innerId, t.identifier("value")), elId)));
              return;
            }
            collectSignals(value.expression);
            const effectId = getImport("effect", state.runtimeSource);
            statements.push(t.expressionStatement(t.callExpression(effectId, [t.arrowFunctionExpression([], t.assignmentExpression("=", t.memberExpression(elId, t.identifier(targetProp)), value.expression))])));
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

      const isSvg = SVG_TAGS.includes(tagName.toLowerCase());
      statements.push(t.variableDeclaration("const", [t.variableDeclarator(elId, isSvg ? t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createElementNS")), [t.stringLiteral("http://www.w3.org/2000/svg"), t.stringLiteral(tagName)]) : t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createElement")), [t.stringLiteral(tagName)]))]));

      n.openingElement.attributes.forEach(attr => {
        if (t.isJSXSpreadAttribute(attr)) {
          const applySpreadId = getImport("applySpread", state.runtimeSource);
          statements.push(t.expressionStatement(t.callExpression(applySpreadId, [elId, attr.argument])));
          return;
        }
        const originalName = attr.name.name;
        const name = originalName.toLowerCase();
        const value = attr.value || t.booleanLiteral(true);

        if (name.startsWith("on")) {
          if (t.isJSXExpressionContainer(value) && t.isJSXEmptyExpression(value.expression)) return;
          statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(elId, t.identifier(name)), t.isJSXExpressionContainer(value) ? value.expression : value)));
        } else if (t.isJSXExpressionContainer(value)) {
          if (t.isJSXEmptyExpression(value.expression)) return;
          if (originalName === "ref" && t.isIdentifier(value.expression) && state.refVars?.has(value.expression.name)) {
            const refName = value.expression.name;
            const innerId = t.identifier(refName);
            innerId._processed = true;
            statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(innerId, t.identifier("value")), elId)));
            return;
          }
          collectSignals(value.expression);
          const effectId = getImport("effect", state.runtimeSource);
          const attrProp = (name === "class" || name === "classname") ? "className" : name;
          const isStyle = attrProp === "style";
          const isProperty = IS_PROPERTY.includes(attrProp);
          const isSvgCamel = isSvg && SVG_CAMEL_CASE.includes(originalName);
          const finalAttrName = isSvgCamel ? originalName : (attrProp === "className" ? "class" : toKebabCase(originalName));

          if (attrProp === "key") {
            statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(elId, t.identifier("_key")), value.expression)));
          } else {
            let assignment;
            if (isStyle) {
              assignment = t.callExpression(t.memberExpression(t.identifier("Object"), t.identifier("assign")), [t.memberExpression(elId, t.identifier("style")), value.expression]);
            } else if (isProperty && (!isSvg || attrProp !== "className")) {
              assignment = t.assignmentExpression("=", t.memberExpression(elId, t.identifier(attrProp)), value.expression);
            } else {
              assignment = t.callExpression(t.memberExpression(elId, t.identifier("setAttribute")), [t.stringLiteral(finalAttrName), value.expression]);
            }
            statements.push(t.expressionStatement(t.callExpression(effectId, [t.arrowFunctionExpression([], assignment)])));
          }
        } else {
          const attrProp = (name === "class" || name === "classname") ? "className" : name;
          const isProperty = IS_PROPERTY.includes(attrProp);
          const isSvgCamel = isSvg && SVG_CAMEL_CASE.includes(originalName);
          const finalAttrName = isSvgCamel ? originalName : (attrProp === "className" ? "class" : toKebabCase(originalName));
          if (isProperty && (!isSvg || attrProp !== "className")) {
            statements.push(t.expressionStatement(t.assignmentExpression("=", t.memberExpression(elId, t.identifier(attrProp === "key" ? "_key" : attrProp)), value)));
          } else {
            statements.push(t.expressionStatement(t.callExpression(t.memberExpression(elId, t.identifier("setAttribute")), [t.stringLiteral(finalAttrName), value])));
          }
        }
      });

      n.children.forEach(child => {
        const childId = processNode(child, elId);
        if (childId) statements.push(t.expressionStatement(t.callExpression(t.memberExpression(elId, t.identifier("appendChild")), [childId])));
      });
      return elId;
    } else if (t.isJSXText(n)) {
      if (n.value.includes("\n") && n.value.trim() === "") return null;
      const text = n.value.replace(/\n\s*/g, " ");
      if (!text) return null;
      const textId = nextId(t, "text");
      statements.push(t.variableDeclaration("const", [t.variableDeclarator(textId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createTextNode")), [t.stringLiteral(text)]))]));
      return textId;
    } else if (t.isJSXFragment(n)) {
      const fragId = nextId(t, "frag");
      statements.push(t.variableDeclaration("const", [t.variableDeclarator(fragId, t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("createDocumentFragment")), []))]));
      n.children.forEach(child => {
        const childId = processNode(child, fragId);
        if (childId) statements.push(t.expressionStatement(t.callExpression(t.memberExpression(fragId, t.identifier("appendChild")), [childId])));
      });
      return fragId;
    } else if (t.isJSXExpressionContainer(n)) {
      if (t.isJSXEmptyExpression(n.expression)) return null;
      collectSignals(n.expression);
      const transformExpression = (exprNode) => {
        if (!exprNode || typeof exprNode !== "object") return;
        if (Array.isArray(exprNode)) {
          exprNode.forEach(transformExpression);
          return;
        }
        Object.keys(exprNode).forEach(key => {
          const child = exprNode[key];
          if (!child || typeof child !== "object") return;
          if (t.isJSXElement(child) || t.isJSXFragment(child)) {
            if (child._processed) return;
            const { statements: innerStatements, rootId: innerRootId, signals: innerSignals } = transformJSX(child, t, state, getImport, path);
            innerSignals.forEach(s => signals.add(s));
            exprNode[key] = t.callExpression(t.arrowFunctionExpression([], t.blockStatement([...innerStatements, t.returnStatement(innerRootId)])), []);
            exprNode[key]._processed = true;
          } else if (t.isCallExpression(child) && t.isMemberExpression(child.callee) && t.isIdentifier(child.callee.property, { name: "map" })) {
            const mappedId = getImport("mapped", state.runtimeSource);
            const sourceArray = child.callee.object;
            const mapFn = child.arguments[0];
            const mappedInstanceId = nextId(t, "mapped");
            statements.push(t.variableDeclaration("const", [t.variableDeclarator(mappedInstanceId, t.callExpression(mappedId, [t.arrowFunctionExpression([], sourceArray), mapFn]))]));
            exprNode[key] = t.callExpression(mappedInstanceId, []);
            transformExpression(mapFn);
          } else {
            transformExpression(child);
          }
        });
      };

      const wrapper = { expr: n.expression };
      transformExpression(wrapper);
      const finalExpression = wrapper.expr;
      const renderDynamicId = getImport("renderDynamic", state.runtimeSource);
      statements.push(t.expressionStatement(t.callExpression(renderDynamicId, [parentElId, t.arrowFunctionExpression([], finalExpression)])));
      return null;
    } else if (t.isExpression(n)) {
      return n;
    }
  }

  const rootId = processNode(node, t.identifier("root"));
  return { statements, rootId, signals };
}
