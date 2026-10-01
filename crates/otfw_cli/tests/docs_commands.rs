use std::{
    fs,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn unified_binary_indexes_inspects_and_queries_docs() {
    let binary = env!("CARGO_BIN_EXE_otfwc");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let site = std::env::temp_dir().join(format!("otfwc-docs-{}-{nonce}", std::process::id()));
    fs::create_dir_all(&site).unwrap();
    let result = std::panic::catch_unwind(|| {
        fs::write(site.join("index.html"), "<main data-otf-search-body><h1>Guide</h1><h2 id='routing'>Routing</h2><p>Alpha</p></main>").unwrap();
        let indexed = Command::new(binary)
            .args(["docs", "index"])
            .arg(&site)
            .output()
            .unwrap();
        assert!(
            indexed.status.success(),
            "{}",
            String::from_utf8_lossy(&indexed.stderr)
        );
        assert!(String::from_utf8_lossy(&indexed.stderr).contains("indexed 1 page"));
        let index = site.join("_search");
        let inspected = Command::new(binary)
            .args(["docs", "inspect"])
            .arg(&index)
            .args(["--term", "alpha"])
            .output()
            .unwrap();
        assert!(inspected.status.success());
        let inspected: serde_json::Value = serde_json::from_slice(&inspected.stdout).unwrap();
        assert_eq!(inspected["df"], 1);
        let queried = Command::new(binary)
            .args(["docs", "query"])
            .arg(&index)
            .arg("Alpha")
            .output()
            .unwrap();
        assert!(queried.status.success());
        let queried: serde_json::Value = serde_json::from_slice(&queried.stdout).unwrap();
        assert_eq!(queried["results"][0]["title"], "Guide");
        assert_eq!(queried["results"][0]["url"], "/");
        assert!(Command::new(binary)
            .args(["docs", "--help"])
            .output()
            .unwrap()
            .status
            .success());
        for args in [vec!["docs"], vec!["docs", "unknown"], vec!["docs", "index"]] {
            assert!(!Command::new(binary)
                .args(args)
                .output()
                .unwrap()
                .status
                .success());
        }
        let incomplete = Command::new(binary)
            .args(["docs", "index"])
            .arg(&site)
            .arg("--out")
            .output()
            .unwrap();
        assert!(!incomplete.status.success());
        assert!(String::from_utf8_lossy(&incomplete.stderr).contains("--out requires"));
    });
    fs::remove_dir_all(site).unwrap();
    if let Err(error) = result {
        std::panic::resume_unwind(error);
    }
}
