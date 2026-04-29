import { addNamed } from "@babel/helper-module-imports";

export const getMemberName = (t, node) => {
  if (t.isJSXIdentifier(node)) return node.name;
  if (t.isJSXMemberExpression(node)) {
    return `${getMemberName(t, node.object)}.${getMemberName(t, node.property)}`;
  }
  return "";
};

export const getImportHelper = (t, path, state) => (importName, source) => {
  const key = `${importName}:${source}`;
  if (!state.importsNeeded.has(key)) {
    state.importsNeeded.set(key, addNamed(path, importName, source));
  }
  return state.importsNeeded.get(key);
};

export const createIdGenerator = () => {
  let counter = 0;
  return (t, prefix = "el") => t.identifier(`${prefix}${counter++}`);
};
