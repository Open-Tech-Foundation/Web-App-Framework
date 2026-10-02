// Browser-safe bridge to the server's async render context. Importing the client
// router must never load a server runtime module.
let readContext = () => undefined;

export function getRenderContext() {
  return readContext();
}

export function setRenderContextReader(reader) {
  readContext = reader;
}
