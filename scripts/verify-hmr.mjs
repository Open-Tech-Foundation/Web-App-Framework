import { Command } from "runtime:system";
import { copy, file, makeTempDir, mkdir, readDir, remove, stat, write } from "runtime:fs";
import { arch, cwd, env, platform } from "runtime:process";
const root = cwd(), children = [], logs = [], errors = [];
const cache = `${root}/.cache`;
await mkdir(cache, { recursive: true });
const project = await makeTempDir({ dir: cache, prefix: "hmr-fixture-" });
async function copyPath(from, to) {
  if ((await stat(from)).isDir) {
    await mkdir(to, { recursive: true });
    for (const entry of await readDir(from)) await copyPath(`${from}/${entry.name}`, `${to}/${entry.name}`);
  } else { await mkdir(to.slice(0, to.lastIndexOf('/')), { recursive: true }); await copy(from, to); }
}
for (const name of ["web", "esdev-plugin-web", "web-compiler"]) {
  const source = `${root}/packages/${name}`;
  const manifest = await file(`${source}/package.json`).json();
  for (const path of ["package.json", ...manifest.files.filter(path => !path.startsWith('!') && path !== 'bin')]) {
    await copyPath(`${source}/${path}`, `${project}/node_modules/@opentf/${name}/${path}`);
  }
}
// The fixture resolves the local compiler through the packaged resolver, with
// no registry dependencies or workspace links.
const os = { linux: "linux", macos: "darwin", windows: "win32" }[platform];
const cpu = { x86_64: "x64", aarch64: "arm64" }[arch];
const binary = platform === "windows" ? "otfwc.exe" : "otfwc";
await copyPath(`${root}/target/debug/${binary}`, `${project}/node_modules/@opentf/web-compiler/bin/${os}-${cpu}/${binary}`);
await mkdir(`${project}/app/other`, { recursive: true });
await write(`${project}/package.json`, JSON.stringify({ private: true, type: "module" }));
await write(`${project}/tsconfig.json`, JSON.stringify({ compilerOptions: { paths: {
  "@opentf/web": ["./node_modules/@opentf/web/index.js"],
  "@opentf/web/hmr": ["./node_modules/@opentf/web/runtime/hmr.js"],
} } }));
await write(`${project}/esdev.json`, JSON.stringify({
  plugins: [{ module: "@opentf/esdev-plugin-web" }],
  resolve: { alias: {
    "@opentf/web": "./node_modules/@opentf/web/index.js",
    "@opentf/web/hmr": "./node_modules/@opentf/web/runtime/hmr.js",
  } },
  build: { targets: { web: { entry: "index.html", outdir: "dist" } } },
}));
await write(`${project}/index.html`, '<html><body><div id="app"></div><script type="module" src="./entry.js"></script></body></html>');
await write(`${project}/entry.js`, 'import { mountApp, navigate } from "@opentf/web"; import { pages } from "@otfw/routes"; import "./style.css"; window.__navigate=navigate; mountApp({pages, guard:(to,tools)=>{window.__guards=(window.__guards||0)+1;tools.next();}, target:document.getElementById("app")});');
await write(`${project}/style.css`, 'body {min-height:3000px} #counter {color:rgb(10,20,30)}');
await write(`${project}/app/other/page.jsx`, 'export default function Other(){return <h1>Other A</h1>;}');
await write(`${project}/app/page.jsx`, 'import Counter from "../Counter.jsx"; import Shell from "../Shell.jsx"; export default function Home() { let visits = $state(0); return <section><h1>Page D</h1><button id="visits" onclick={() => visits++}>Visits {visits}</button><Shell><Counter/></Shell><input id="draft"/></section>; }');
await write(`${project}/app/layout.jsx`, 'export default function Layout(props) { return <main><p id="layout">Layout B</p>{props.children}</main>; }');
await write(`${project}/Shell.jsx`, 'export default function Shell({children}) { return <div id="shell">Shell A{children}</div>; }');
await write(`${project}/Counter.jsx`, `export default function Counter() {
 let count=$state(0);
 let draft=$state("");
 let input=$ref();
 let doubled=$derived(count*2);
 onMount(()=>{window.__mounts=(window.__mounts||0)+1;return()=>{window.__disposals=(window.__disposals||0)+1;};});
 $effect(()=>{window.__effectRuns=(window.__effectRuns||0)+1;window.__observed=count;return()=>{window.__effectDisposals=(window.__effectDisposals||0)+1;};});
 $effect(()=>{window.__currentRef=input;});
 return <div><Badge/><button id="counter" onclick={()=>count++}>Component A: {count}</button><p id="derived">{doubled}</p><input id="internal" ref={input} value={draft} oninput={event=>draft=event.target.value}/></div>;
}
function Badge() {
 onMount(()=>{window.__badgeMounts=(window.__badgeMounts||0)+1;return()=>{window.__badgeDisposals=(window.__badgeDisposals||0)+1;};});
 return <span>Badge</span>;
}`);

const port = 24000 + Math.floor(Math.random() * 10000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function launch(args, options = {}) {
  const child = await new Command(args[0], { args: args.slice(1), cwd: root, inheritEnv: true, stdout: "piped", stderr: "piped", ...options }).spawn();
  children.push(child);
  logs.push(Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]));
  return child;
}
async function ready(url) {
  for (let i = 0; i < 200; i++) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await delay(100);
  }
  throw Error(`Server unavailable: ${url}`);
}
function assert(value, label) { if (!value) throw Error(label); console.log(`PASS ${label}`); }
const profile = await makeTempDir({ dir: `${root}/.cache`, prefix: "site-chrome-" });
let ws;
let passed = false;
try {
  await launch([env.CHROMIUM_BIN || "/usr/bin/chromium", "--headless=new", "--no-sandbox", "--disable-gpu", `--user-data-dir=${profile}`, `--remote-debugging-port=${port + 2}`, "about:blank"]);
  const targets = await (await ready(`http://127.0.0.1:${port + 2}/json`)).json();
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map();
  ws.onmessage = event => { const message = JSON.parse(event.data); if (pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(Error(message.error.message)) : resolve(message.result); } if (message.method === "Network.responseReceived" && message.params.response.status >= 400) errors.push(`${message.params.response.status} ${message.params.response.url}`); if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description); };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const request = ++id; pending.set(request, { resolve, reject }); ws.send(JSON.stringify({ id: request, method, params })); });
  const evaluate = async expression => { const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description); return result.result.value; };
  async function until(expression) { for (let i = 0; i < 150; i++) { const result = await evaluate(expression); if (result) return result; await delay(100); } throw Error(`Browser timeout: ${expression}`); }
  await send("Runtime.enable"); await send("Page.enable");
  await send("Network.enable");
  const serverPort=port+10;
  await launch(["esdev","start",`--port=${serverPort}`],{cwd:project});
  const origin=`http://127.0.0.1:${serverPort}`;
  await ready(origin);
  await send("Page.addScriptToEvaluateOnNewDocument",{source:"window.__hmrDocumentToken=crypto.randomUUID();"});
  await send("Page.navigate",{url:origin});
  await until(`!!document.getElementById('counter')`);
  const token=await evaluate('window.__hmrDocumentToken');
  await evaluate("document.getElementById('counter').click();document.getElementById('counter').click();document.getElementById('draft').value='unsaved';document.getElementById('internal').value='local draft';document.getElementById('internal').dispatchEvent(new Event('input'));document.getElementById('internal').focus();document.getElementById('internal').setSelectionRange(2,5);window.scrollTo(0,100);window.__originalHost=document.querySelector('.web-counter');");
  await write(project+'/style.css','body {min-height:3000px} #counter {color:rgb(44,55,66)}');
  await until('getComputedStyle(document.getElementById("counter")).color==="rgb(44, 55, 66)"');
  assert(await evaluate('window.__hmrDocumentToken')===token,'CSS retains document');
  const initial=await file(project+'/Counter.jsx').text();
  for(const label of ['B','C']) {
    const current=await file(project+'/Counter.jsx').text();await write(project+'/Counter.jsx',current.replace(/Component [ABC]/,'Component '+label));
    await until(`document.getElementById('counter')?.textContent==='Component ${label}: 2'`);
    assert(await evaluate('window.__hmrDocumentToken')===token,'component '+label+' retains document');
    assert(await evaluate('document.querySelector(".web-counter")===window.__originalHost'),'stable host');
    assert(await evaluate('scrollY===100'),'component refresh retains scroll');
    assert(await evaluate('document.getElementById("internal").selectionStart===2 && document.getElementById("internal").selectionEnd===5'),'component refresh retains selection');
    assert(await evaluate('document.getElementById("draft").value==="unsaved" && document.activeElement.id==="internal"'),'external draft and component focus retained');
  }
  assert(await evaluate('document.getElementById("internal").value==="local draft"'),'component state-backed input retained');
  assert(await evaluate('window.__currentRef===document.getElementById("internal")'),'ref rebound to new node');
  assert(await evaluate('document.getElementById("derived").textContent==="4"'),'derived value recreated from retained state');
  assert(await evaluate('window.__mounts===3 && window.__disposals===2'),'mount cleanup once per refresh');
  await delay(50);
  assert(await evaluate('window.__badgeMounts===3 && window.__badgeDisposals===2'),'co-located child mounts once per module refresh');
  await evaluate('document.getElementById("counter").click()');
  await until('window.__observed===3');
  assert(await evaluate('window.__effectRuns===6 && window.__effectDisposals===5'),'old effects disposed and no duplicate subscription');
  const shell=await file(project+'/Shell.jsx').text();
  await write(project+'/Shell.jsx',shell.replace('Shell A','Shell B'));
  await until('document.getElementById("shell").textContent.startsWith("Shell B")');
  assert(await evaluate('document.querySelector(".web-counter")===window.__originalHost && document.getElementById("counter").textContent.endsWith(": 3")'),'slotted child host and state survive parent refresh');
  assert(await evaluate('window.__mounts===3 && window.__disposals===2'),'slot movement does not remount child');
  await evaluate('(async()=>{const host=window.__originalHost;const parent=host.parentNode;host.remove();await Promise.resolve();parent.appendChild(host);})()');
  await until('document.getElementById("counter").textContent==="Component C: 0"');
  assert(await evaluate('window.__mounts===4 && window.__disposals===3'),'genuine remount initializes fresh state and cleans up');
  for (const [path,from,to,check] of [
    ['app/page.jsx','Page D','Page E',"document.querySelector('h1')?.textContent==='Page E'"],
    ['app/layout.jsx','Layout B','Layout C',"document.getElementById('layout')?.textContent==='Layout C'"],
  ]) {
    const url=await evaluate('location.href');const guardCount=await evaluate('window.__guards');const historyLength=await evaluate('history.length');const old=await file(project+'/'+path).text();
    await evaluate('document.getElementById("visits").click();document.getElementById("counter").click()');
    const visits=await evaluate('document.getElementById("visits").textContent');
    const counter=await evaluate('document.getElementById("counter").textContent');
    const pageHost=await evaluate('window.__pageSection=document.querySelector("section");true');
    await write(project+'/'+path,old.replace(from,to));await until(check);
    assert(pageHost && await evaluate('window.__hmrDocumentToken')===token,path+' refresh retains document');
    assert(await evaluate('location.href')===url,path+' retains URL');
    assert(await evaluate('window.__guards')===guardCount,path+' does not rerun guard');
    assert(await evaluate('history.length')===historyLength,path+' does not mutate history');
    assert(await evaluate('document.getElementById("visits").textContent')===visits,path+' keeps page state');
    if (path==='app/layout.jsx') {
      assert(await evaluate('document.querySelector("section")===window.__pageSection'),'app/layout.jsx keeps the page view in place');
      assert(await evaluate('document.getElementById("counter").textContent')===counter,'app/layout.jsx keeps child component state');
    } else {
      assert(await evaluate('document.getElementById("counter").textContent.endsWith(": 0")'),'app/page.jsx rebuilds the page view and its children');
    }
  }
  await write(project+'/Counter.jsx',(await file(project+'/Counter.jsx').text()).replace('let count=$state(0);','let count=$state(0); let extra=$state(1);'));
  await until('window.__hmrDocumentToken!=='+JSON.stringify(token));
  await until('document.getElementById("counter")?.textContent==="Component C: 0"');
  assert(true,'incompatible state declaration reloads');
  const shapeToken=await evaluate('window.__hmrDocumentToken');
  await write(project+'/Counter.jsx','export const helper = 1;\n'+(await file(project+'/Counter.jsx').text()));
  await until('window.__hmrDocumentToken!=='+JSON.stringify(shapeToken));
  await until('document.getElementById("counter")?.textContent==="Component C: 0"');
  assert(true,'introducing a helper export reloads');
  const helperToken=await evaluate('window.__hmrDocumentToken');
  const withProps=(await file(project+'/Counter.jsx').text()).replace('export const helper = 1;\n','').replace('function Counter()','function Counter({label = "Label"})').replace('<Badge/>','<Badge/><span id="prop">{label}</span>');
  await write(project+'/Counter.jsx',withProps);
  await until('window.__hmrDocumentToken!=='+JSON.stringify(helperToken));
  await until('document.getElementById("prop")?.textContent==="Label"');
  assert(true,'changing observed props reloads with the new constructor');
  await evaluate('window.__navigate("/other")');await until('document.querySelector("h1")?.textContent==="Other A"');
  await evaluate('window.__navigate("/")');await until('document.getElementById("counter")?.textContent==="Component C: 0"');
  const activeToken=await evaluate('window.__hmrDocumentToken');
  await evaluate('document.getElementById("counter").click()');
  await write(project+'/app/other/page.jsx',(await file(project+'/app/other/page.jsx').text()).replace('Other A','Other B'));
  await delay(600);
  assert(await evaluate('window.__hmrDocumentToken')===activeToken,'inactive route edit retains document');
  assert(await evaluate('document.querySelector("h1").textContent==="Page E" && document.getElementById("counter").textContent==="Component C: 1"'),'inactive route edit leaves active view and state intact');
  await evaluate('window.__navigate("/other")');await until('document.querySelector("h1")?.textContent==="Other B"');
  assert(await evaluate('window.__hmrDocumentToken')===activeToken,'updated inactive route renders on client navigation');
  const otherPage=await file(project+'/app/other/page.jsx').text();
  await write(project+'/app/other/page.jsx',otherPage.replace('<h1>Other B</h1>','<h1>Other B</h1 <<'));
  await delay(1500);
  assert(await evaluate('document.querySelector("h1")?.textContent==="Other B"'),'compile error keeps the previous view');
  await write(project+'/app/other/page.jsx',otherPage.replace('Other B','Other C'));
  await until('document.querySelector("h1")?.textContent==="Other C"');
  assert((await fetch(origin)).ok,'dev server survives fixing a compile error');
  const failures=errors.filter(error => error && !error.includes('/favicon.ico'));
  assert(failures.length===0,'no browser errors: '+JSON.stringify(failures));
  passed = true;

} finally {
  if (errors.some(error => error && !error.includes("/favicon.ico"))) console.error("Browser errors", JSON.stringify(errors));
  ws?.close();
  for (const child of children.reverse()) { child.kill(); await child.status; }
  const output = await Promise.all(logs);
  if (!passed || env.HMR_VERBOSE) for (const [out, err] of output) if (out || err) console.log("SERVER OUTPUT",out,err);
  await remove(project, { recursive: true });
  for (let retry = 0; retry < 5; retry++) { try { await remove(profile, { recursive: true }); break; } catch { await delay(100); } }
}
