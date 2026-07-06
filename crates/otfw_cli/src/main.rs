//! OTF Web toolchain CLI (`otfwc`).
//!
//! Status: foundation. A minimal driver that runs the compiler pipeline
//! (parse → lower → CSR codegen). `build` compiles a single file (one process per
//! file); `serve` keeps the process alive and compiles many files over a framed
//! stdin/stdout protocol, so the toolchain pays the process-startup cost once
//! instead of per module. The full orchestrator (dev server, HMR, incremental
//! cache) described in `ARCHITECTURE.md` §8 is implemented here over time.

use std::io::{self, BufRead, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use otfw_compiler::codegen::{csr, hydrate, ssg};
use otfw_compiler::graph::{DiskVfs, ModuleGraph, Resolver};
use otfw_compiler::lower::lower_module;
use otfw_compiler::mdx::mdx_to_jsx;
use otfw_compiler::parse::ParseSession;

/// Which codegen backend to run (ARCHITECTURE.md §6). CSR builds the live DOM; SSG
/// emits HTML strings at build/request time; Hydrate adopts the server DOM.
#[derive(Clone, Copy)]
enum Target {
    Csr,
    Ssg,
    Hydrate,
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("build") => {
            let rest = &args[2..];
            let as_component = rest.iter().any(|a| a == "--component");
            let from_stdin = rest.iter().any(|a| a == "--stdin");
            let target = if rest.iter().any(|a| a == "--target=hydrate") {
                Target::Hydrate
            } else if rest.iter().any(|a| a == "--target=ssg" || a == "--ssg") {
                Target::Ssg
            } else {
                Target::Csr
            };
            match rest.iter().find(|a| !a.starts_with("--")) {
                Some(file) => build(file, as_component, from_stdin, target),
                None => {
                    eprintln!("usage: otfwc build [--component] [--stdin] [--target=ssg|hydrate] <file.tsx>");
                    ExitCode::FAILURE
                }
            }
        }
        Some("serve") => serve(),
        Some("graph") => graph_cmd(&args[2..]),
        _ => {
            println!("otfwc: OTF Web IR compiler (foundation). See ARCHITECTURE.md.");
            println!("usage: otfwc build [--component] [--stdin] <file.tsx>   # parse → lower → CSR codegen");
            println!("  default emits a page factory; --component emits a Custom Element class");
            println!("  --stdin reads source from stdin; <file> is used only for the module id");
            println!("       otfwc serve   # long-lived compiler: framed requests on stdin, results on stdout");
            println!("       otfwc graph [--web=<path>] <entry...>   # crawl the module graph as JSON");
            ExitCode::SUCCESS
        }
    }
}

/// Crawl the module graph from one or more entry files and print it as JSON
/// (`{ "modules": [ { id, fingerprint, env, external, deps: [...] } ] }`). `--web`
/// points the `@opentf/web` alias at the runtime entry; without it the framework
/// import resolves as an external leaf. The orchestrator consumes this to compile a
/// route's subgraph on demand and to invalidate precisely on a change (§5.2).
fn graph_cmd(args: &[String]) -> ExitCode {
    let mut web_entry: Option<PathBuf> = None;
    let mut entries: Vec<PathBuf> = Vec::new();
    for a in args {
        if let Some(p) = a.strip_prefix("--web=") {
            web_entry = Some(PathBuf::from(p));
        } else if a.starts_with("--") {
            eprintln!("otfwc graph: unknown flag {a}");
            return ExitCode::FAILURE;
        } else {
            entries.push(PathBuf::from(a));
        }
    }
    if entries.is_empty() {
        eprintln!("usage: otfwc graph [--web=<path>] <entry...>");
        return ExitCode::FAILURE;
    }

    // Default the `@opentf/web` alias to a non-existent path when unspecified, so the
    // framework import falls through to an external leaf rather than erroring.
    let resolver = Resolver::new(web_entry.unwrap_or_else(|| PathBuf::from("@opentf/web")));
    let graph = ModuleGraph::build(&entries, &resolver, &DiskVfs);

    let mut out = String::from("{\"modules\":[");
    for (i, node) in graph.nodes.values().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let env = match node.environment {
            otfw_compiler::graph::Environment::Client => "client",
            otfw_compiler::graph::Environment::Server => "server",
            otfw_compiler::graph::Environment::Shared => "shared",
        };
        out.push_str(&format!(
            "{{\"id\":{},\"fingerprint\":{},\"env\":\"{env}\",\"external\":{},\"deps\":[",
            json_str(&node.id),
            json_str(&node.fingerprint),
            node.external,
        ));
        for (j, edge) in node.deps.iter().enumerate() {
            if j > 0 {
                out.push(',');
            }
            out.push_str(&format!(
                "{{\"specifier\":{},\"target\":{},\"dynamic\":{},\"external\":{}}}",
                json_str(&edge.specifier),
                json_str(&edge.target),
                edge.dynamic,
                edge.external,
            ));
        }
        out.push_str("]}");
    }
    out.push_str("]}");
    println!("{out}");
    eprintln!("otfwc graph: {} module(s)", graph.nodes.len());
    ExitCode::SUCCESS
}

/// Minimal JSON string encoder (escapes the characters JSON requires); enough for
/// file paths and hex fingerprints without pulling in a serialization dependency.
fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Compile one module to its emitted JS. `as_component` selects the Custom Element
/// backend (page/layout factories pass `false`); `ssg` selects the HTML-string
/// backend over CSR. `.mdx`/`.md` ids run the MDX front-end first. Returns the code
/// plus any non-fatal codegen warnings, or a formatted diagnostic on failure.
fn compile_module(
    file: &str,
    source: String,
    as_component: bool,
    target: Target,
) -> Result<(String, Vec<String>), String> {
    // MDX front-end: `.mdx`/`.md` lower to JSX source first, then run the normal
    // parse → lower → codegen pipeline (the module id keeps the original extension).
    let source = if file.ends_with(".mdx") || file.ends_with(".md") {
        mdx_to_jsx(&source, file).map_err(|e| format!("MDX error in {file}: {e}"))?
    } else {
        source
    };

    let session = ParseSession::new();
    let parsed = session.parse(Path::new(file), &source);
    if !parsed.is_clean() {
        let msg = parsed
            .errors
            .iter()
            .map(|e| format!("parse error: {e}"))
            .collect::<Vec<_>>()
            .join("\n");
        return Err(msg);
    }

    // A function-valued `ref` is unsupported — fail with actionable guidance rather
    // than miscompiling it into `(fn).value = el`.
    if let Some(msg) = otfw_compiler::lower::function_ref_diagnostic(&parsed.program) {
        return Err(format!("{file}: {msg}"));
    }

    // Mutating a `$state` value in place (`list.push(x)`, `list[0] = x`, …) never
    // notifies its signal — fail with the immutable-update fix rather than silently
    // dropping the update.
    if let Some(msg) = otfw_compiler::lower::state_mutation_diagnostic(&parsed.program, &source) {
        return Err(format!("{file}: {msg}"));
    }

    let Some(lowered) = lower_module(file, &parsed.program, &source, !as_component) else {
        // Prefer a targeted diagnostic for the common near-miss (JSX built but not
        // returned as the view) over the generic "no component" message.
        if let Some(hint) = otfw_compiler::lower::no_component_diagnostic(&parsed.program) {
            return Err(format!("{file}: {hint}"));
        }
        return Err(format!("no component (function returning JSX) found in {file}"));
    };

    let (code, warnings) = match target {
        Target::Ssg => {
            let m = ssg::emit_module(&lowered.components, &lowered.module_stmts, &lowered.module_exprs);
            (m.code, m.errors)
        }
        Target::Hydrate => {
            let m =
                hydrate::emit_module(&lowered.components, &lowered.module_stmts, &lowered.module_exprs);
            (m.code, m.errors)
        }
        Target::Csr => {
            let m = csr::emit_module(&lowered.components, &lowered.module_stmts, &lowered.module_exprs);
            (m.code, m.errors)
        }
    };
    Ok((code, warnings))
}

/// Compile one module and print it. Source comes from `file` or, with `from_stdin`,
/// from stdin (then `file` is only the module id). Diagnostics go to stderr.
fn build(file: &str, as_component: bool, from_stdin: bool, target: Target) -> ExitCode {
    let source = if from_stdin {
        let mut buf = String::new();
        if let Err(e) = io::stdin().read_to_string(&mut buf) {
            eprintln!("otfw: cannot read stdin: {e}");
            return ExitCode::FAILURE;
        }
        buf
    } else {
        match std::fs::read_to_string(file) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("otfw: cannot read {file}: {e}");
                return ExitCode::FAILURE;
            }
        }
    };

    match compile_module(file, source, as_component, target) {
        Ok((code, warnings)) => {
            print!("{code}");
            for w in &warnings {
                eprintln!("warning: {w}");
            }
            ExitCode::SUCCESS
        }
        Err(msg) => {
            eprintln!("{msg}");
            ExitCode::FAILURE
        }
    }
}

/// Long-lived compiler loop. Each request is a header line
/// `<id_len> <source_len> <component> <target>\n` (byte counts; `component` is the
/// flag `0`/`1`; `target` is the token `csr`/`ssg`/`hydrate`), immediately followed
/// by `id_len` bytes of module id and `source_len` bytes of source. Each reply is
/// `OK <len>\n<code>` on success or `ERR <len>\n<message>` on a compile error — the
/// server stays up either way. Lengths are byte counts so the payloads may contain
/// newlines (source, multi-line diagnostics). EOF ends the loop.
fn serve() -> ExitCode {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let stdout = io::stdout();
    let mut writer = stdout.lock();
    let mut header = String::new();

    loop {
        header.clear();
        match reader.read_line(&mut header) {
            Ok(0) => break, // EOF — toolchain closed the pipe.
            Ok(_) => {}
            Err(e) => {
                eprintln!("otfwc serve: read error: {e}");
                return ExitCode::FAILURE;
            }
        }
        let line = header.trim_end_matches(['\r', '\n']);
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split(' ').collect();
        let parsed = (parts.len() == 4)
            .then(|| {
                Some((
                    parts[0].parse::<usize>().ok()?,
                    parts[1].parse::<usize>().ok()?,
                    parts[2] == "1",
                    parts[3].to_string(),
                ))
            })
            .flatten();
        let Some((id_len, src_len, as_component, target_tok)) = parsed else {
            write_frame(&mut writer, false, format!("protocol error: bad header {line:?}").as_bytes());
            continue;
        };

        let mut id_buf = vec![0u8; id_len];
        let mut src_buf = vec![0u8; src_len];
        if reader.read_exact(&mut id_buf).is_err() || reader.read_exact(&mut src_buf).is_err() {
            break; // truncated request — pipe closed.
        }
        let id = String::from_utf8_lossy(&id_buf).into_owned();
        let source = String::from_utf8_lossy(&src_buf).into_owned();

        // The serve protocol's 4th field selects the codegen backend by token; an
        // unknown token falls back to CSR (the safe default).
        let target = match target_tok.as_str() {
            "ssg" => Target::Ssg,
            "hydrate" => Target::Hydrate,
            _ => Target::Csr,
        };
        match compile_module(&id, source, as_component, target) {
            // Warnings are non-fatal and not consumed by the toolchain; drop them.
            Ok((code, _warnings)) => write_frame(&mut writer, true, code.as_bytes()),
            Err(msg) => write_frame(&mut writer, false, msg.as_bytes()),
        }
    }
    ExitCode::SUCCESS
}

/// Write one length-prefixed reply frame and flush so the toolchain can read it.
fn write_frame<W: Write>(w: &mut W, ok: bool, payload: &[u8]) {
    let status = if ok { "OK" } else { "ERR" };
    let _ = write!(w, "{status} {}\n", payload.len());
    let _ = w.write_all(payload);
    let _ = w.flush();
}
