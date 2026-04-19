export function createPropsProxy(el) {
  return new Proxy({}, {
    get(_, key) {
      if (key in el) return el[key]
      return el._propsSignals[key]?.value
    }
  })
}
