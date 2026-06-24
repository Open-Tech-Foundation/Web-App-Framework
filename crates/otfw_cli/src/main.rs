//! OTF Web toolchain CLI (`otfwc`).
//!
//! Status: foundation. A minimal driver that runs the compiler pipeline
//! (parse → lower → CSR codegen). `build` compiles a single file (one process per
//! file); `serve` keeps the process alive and compiles many files over a framed
//! stdin/stdout protocol, so the toolchain pays the process-startup cost once
//! instead of per module. The full orchestrator (dev server, HMR, incremental
//! cache) described in `ARCHITECTURE.md` §8 is implemented here over time.

use std::io::{self, BufRead, Read, Write};
use std::path::Path;
use std::process::ExitCode;

use otfw_compiler::codegen::{csr, ssg};
use otfw_compiler::lower::lower_module;
use otfw_compiler::mdx::mdx_to_jsx;
use otfw_compiler::parse::ParseSession;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("build") => {
            let rest = &args[2..];
            let as_component = rest.iter().any(|a| a == "--component");
            let from_stdin = rest.iter().any(|a| a == "--stdin");
            let ssg = rest.iter().any(|a| a == "--target=ssg" || a == "--ssg");
            match rest.iter().find(|a| !a.starts_with("--")) {
                Some(file) => build(file, as_component, from_stdin, ssg),
                None => {
                    eprintln!("usage: otfwc build [--component] [--stdin] [--target=ssg] <file.tsx>");
                    ExitCode::FAILURE
                }
            }
        }
        Some("serve") => serve(),
        _ => {
            println!("otfwc: OTF Web IR compiler (foundation). See ARCHITECTURE.md.");
            println!("usage: otfwc build [--component] [--stdin] <file.tsx>   # parse → lower → CSR codegen");
            println!("  default emits a page factory; --component emits a Custom Element class");
            println!("  --stdin reads source from stdin; <file> is used only for the module id");
            println!("       otfwc serve   # long-lived compiler: framed requests on stdin, results on stdout");
            ExitCode::SUCCESS
        }
    }
}

/// Compile one module to its emitted JS. `as_component` selects the Custom Element
/// backend (page/layout factories pass `false`); `ssg` selects the HTML-string
/// backend over CSR. `.mdx`/`.md` ids run the MDX front-end first. Returns the code
/// plus any non-fatal codegen warnings, or a formatted diagnostic on failure.
fn compile_module(
    file: &str,
    source: String,
    as_component: bool,
    ssg: bool,
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

    let Some(lowered) = lower_module(file, &parsed.program, &source, !as_component) else {
        return Err(format!("no component (function returning JSX) found in {file}"));
    };

    let (code, warnings) = if ssg {
        let m = ssg::emit_module(&lowered.components, &lowered.module_stmts, &lowered.module_exprs);
        (m.code, m.errors)
    } else {
        let m = csr::emit_module(&lowered.components, &lowered.module_stmts, &lowered.module_exprs);
        (m.code, m.errors)
    };
    Ok((code, warnings))
}

/// Compile one module and print it. Source comes from `file` or, with `from_stdin`,
/// from stdin (then `file` is only the module id). Diagnostics go to stderr.
fn build(file: &str, as_component: bool, from_stdin: bool, ssg: bool) -> ExitCode {
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

    match compile_module(file, source, as_component, ssg) {
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
/// `<id_len> <source_len> <component> <ssg>\n` (byte counts; flags `0`/`1`),
/// immediately followed by `id_len` bytes of module id and `source_len` bytes of
/// source. Each reply is `OK <len>\n<code>` on success or `ERR <len>\n<message>` on
/// a compile error — the server stays up either way. Lengths are byte counts so the
/// payloads may contain newlines (source, multi-line diagnostics). EOF ends the loop.
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
                    parts[3] == "1",
                ))
            })
            .flatten();
        let Some((id_len, src_len, as_component, ssg)) = parsed else {
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

        match compile_module(&id, source, as_component, ssg) {
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
