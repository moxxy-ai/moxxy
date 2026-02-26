use crate::core::memory;
use crate::core::orchestrator::seed_default_templates;

#[tokio::test]
async fn seed_default_templates_creates_two_when_empty() {
    let mem = memory::test_memory_system().await;

    let added = seed_default_templates(&mem).await.unwrap();
    assert_eq!(added, 2, "should add 2 templates when none exist");

    let list = mem.list_orchestrator_templates().await.unwrap();
    assert_eq!(list.len(), 2);

    let ids: Vec<&str> = list.iter().map(|t| t.template_id.as_str()).collect();
    assert!(ids.contains(&"simple"));
    assert!(ids.contains(&"builder-checker-merger"));
}

#[tokio::test]
async fn seed_default_templates_skips_when_templates_exist() {
    let mem = memory::test_memory_system().await;

    // First seed adds 2
    let added1 = seed_default_templates(&mem).await.unwrap();
    assert_eq!(added1, 2);

    // Second seed adds 0 (already exist)
    let added2 = seed_default_templates(&mem).await.unwrap();
    assert_eq!(added2, 0);
}
