//! OpenTF Web toolchain CLI (`otfw`).
//!
//! Status: foundation. A minimal driver that runs the compiler pipeline
//! (parse → lower → CSR codegen) over a single file and prints the result. The
//! full orchestrator (dev server, build, HMR, incremental cache) described in
//! `ARCHITECTURE.md` §8 is implemented here over time.

use std::path::Path;
use std::process::ExitCode;

use otfw_compiler::codegen::csr;
use otfw_compiler::lower::lower_component;
use otfw_compiler::parse::ParseSession;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("build") => {
            let rest = &args[2..];
            let as_component = rest.iter().any(|a| a == "--component");
            match rest.iter().find(|a| !a.starts_with("--")) {
                Some(file) => build(file, as_component),
                None => {
                    eprintln!("usage: otfw build [--component] <file.tsx>");
                    ExitCode::FAILURE
                }
            }
        }
        _ => {
            println!("otfw: OpenTF Web toolchain (foundation). See ARCHITECTURE.md.");
            println!("usage: otfw build [--component] <file.tsx>   # parse → lower → CSR codegen");
            println!("  default emits a page factory; --component emits a Custom Element class");
            ExitCode::SUCCESS
        }
    }
}

/// Compile one file to CSR JS and print it. Diagnostics go to stderr.
fn build(file: &str, as_component: bool) -> ExitCode {
    let source = match std::fs::read_to_string(file) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("otfw: cannot read {file}: {e}");
            return ExitCode::FAILURE;
        }
    };

    let session = ParseSession::new();
    let parsed = session.parse(Path::new(file), &source);
    if !parsed.is_clean() {
        for err in &parsed.errors {
            eprintln!("parse error: {err}");
        }
        return ExitCode::FAILURE;
    }

    let Some(lowered) = lower_component(file, &parsed.program, &source) else {
        eprintln!("otfw: no component (function returning JSX) found in {file}");
        return ExitCode::FAILURE;
    };

    let module = if as_component { csr::emit_component(&lowered) } else { csr::emit_page(&lowered) };
    print!("{}", module.code);

    for err in &module.errors {
        eprintln!("warning: {err}");
    }
    ExitCode::SUCCESS
}
