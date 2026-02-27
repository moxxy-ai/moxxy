use crate::core::memory;
use crate::core::orchestrator::seed_default_templates;

#[tokio::test]
async fn seed_default_templates_creates_six_when_empty() {
    let mem = memory::test_memory_system().await;

    let added = seed_default_templates(&mem).await.unwrap();
    assert_eq!(added, 6, "should add 6 templates when none exist");

    let list = mem.list_orchestrator_templates().await.unwrap();
    assert_eq!(list.len(), 6);

    let ids: Vec<&str> = list.iter().map(|t| t.template_id.as_str()).collect();
    assert!(ids.contains(&"simple"));
    assert!(ids.contains(&"builder-checker-merger"));
    assert!(ids.contains(&"dev-pipeline"));
    assert!(ids.contains(&"research-report"));
    assert!(ids.contains(&"multi-repo"));
    assert!(ids.contains(&"parallel-workers"));
}

#[tokio::test]
async fn seed_default_templates_skips_when_templates_exist() {
    let mem = memory::test_memory_system().await;

    // First seed adds 6
    let added1 = seed_default_templates(&mem).await.unwrap();
    assert_eq!(added1, 6);

    // Second seed adds 0 (already exist)
    let added2 = seed_default_templates(&mem).await.unwrap();
    assert_eq!(added2, 0);
}
