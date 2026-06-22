//! OTF Web toolchain CLI (`otfw`).
//!
//! Status: foundation. A minimal driver that runs the compiler pipeline
//! (parse → lower → CSR codegen) over a single file and prints the result. The
//! full orchestrator (dev server, build, HMR, incremental cache) described in
//! `ARCHITECTURE.md` §8 is implemented here over time.

use std::io::Read;
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
        _ => {
            println!("otfwc: OTF Web IR compiler (foundation). See ARCHITECTURE.md.");
            println!("usage: otfwc build [--component] [--stdin] <file.tsx>   # parse → lower → CSR codegen");
            println!("  default emits a page factory; --component emits a Custom Element class");
            println!("  --stdin reads source from stdin; <file> is used only for the module id");
            ExitCode::SUCCESS
        }
    }
}

/// Compile one module and print it. `ssg` selects the SSG (HTML-string) backend;
/// otherwise CSR. Source comes from `file` or, with `from_stdin`, from stdin (then
/// `file` is only the module id). Diagnostics go to stderr.
fn build(file: &str, as_component: bool, from_stdin: bool, ssg: bool) -> ExitCode {
    let source = if from_stdin {
        let mut buf = String::new();
        if let Err(e) = std::io::stdin().read_to_string(&mut buf) {
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

    // MDX front-end: `.mdx`/`.md` lower to JSX source first, then run the normal
    // parse → lower → codegen pipeline (the module id keeps the original extension).
    let source = if file.ends_with(".mdx") || file.ends_with(".md") {
        match mdx_to_jsx(&source, file) {
            Ok(jsx) => jsx,
            Err(e) => {
                eprintln!("otfw: MDX error in {file}: {e}");
                return ExitCode::FAILURE;
            }
        }
    } else {
        source
    };

    let session = ParseSession::new();
    let parsed = session.parse(Path::new(file), &source);
    if !parsed.is_clean() {
        for err in &parsed.errors {
            eprintln!("parse error: {err}");
        }
        return ExitCode::FAILURE;
    }

    let Some(lowered) = lower_module(file, &parsed.program, &source, !as_component) else {
        eprintln!("otfw: no component (function returning JSX) found in {file}");
        return ExitCode::FAILURE;
    };

    let (code, errors) = if ssg {
        let m = ssg::emit_module(&lowered.components, &lowered.module_stmts, &lowered.module_exprs);
        (m.code, m.errors)
    } else {
        let m = csr::emit_module(&lowered.components, &lowered.module_stmts, &lowered.module_exprs);
        (m.code, m.errors)
    };
    print!("{code}");

    for err in &errors {
        eprintln!("warning: {err}");
    }
    ExitCode::SUCCESS
}
