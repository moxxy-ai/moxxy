import Foundation
import Testing
@testable import ComputerUseCore

private func app(_ id: String, _ name: String, running: Bool = false, path: String? = nil) -> AppRecord {
    AppRecord(id: id, name: name, path: path ?? "/Applications/\(name).app", running: running)
}

@Suite struct AppCatalogTests {
    @Test func mergesRunningOverInstalledAndListsRunningFirst() {
        let merged = AppCatalog.merge(
            running: [app("com.apple.TextEdit", "TextEdit", running: true)],
            installed: [app("com.apple.calculator", "Calculator"), app("com.apple.textedit", "TextEdit"), app("com.apple.Automator", "Automator")]
        )
        #expect(merged.map(\.id) == ["com.apple.TextEdit", "com.apple.Automator", "com.apple.calculator"])
        #expect(merged.first?.running == true)
    }

    @Test func filtersByNameOrIdentifierAndReportsTruncation() {
        let apps = [app("com.apple.Safari", "Safari"), app("com.apple.mail", "Mail"), app("org.mozilla.firefox", "Firefox")]
        #expect(AppCatalog.page(apps, query: "APPLE", limit: 10).apps.map(\.name) == ["Safari", "Mail"])
        #expect(AppCatalog.page(apps, query: "fire", limit: 10).apps.map(\.name) == ["Firefox"])
        let page = AppCatalog.page(apps, query: nil, limit: 2)
        #expect(page.apps.count == 2)
        #expect(page.truncated)
    }

    @Test(arguments: [
        ("com.apple.textedit", "com.apple.TextEdit"),
        ("TextEdit", "com.apple.TextEdit"),
        ("textedit.app", "com.apple.TextEdit"),
        ("/System/Applications/TextEdit.app", "com.apple.TextEdit"),
    ])
    func resolvesByIdentifierNameOrPath(request: String, id: String) {
        let apps = [app("com.apple.TextEdit", "TextEdit", path: "/System/Applications/TextEdit.app"), app("com.apple.Notes", "Notes")]
        #expect(AppCatalog.resolve(request, in: apps) == .resolved(apps[0]))
    }

    @Test func reportsAmbiguousAndMissingNames() {
        let apps = [app("com.example.one", "Notes"), app("com.example.two", "Notes")]
        #expect(AppCatalog.resolve("notes", in: apps) == .ambiguous(apps))
        #expect(AppCatalog.resolve("Mail", in: apps) == .notFound)
        #expect(AppCatalog.resolve("com.example.two", in: apps) == .resolved(apps[1]))
    }

    @Test func asksTheSystemForAnIdentifierOutsideTheScannedFolders() {
        let elsewhere = AppRecord(id: "com.example.elsewhere", name: "Elsewhere", path: "/tmp/Elsewhere.app", running: false)
        let lookup = { (id: String) in id == elsewhere.id ? elsewhere : nil }
        #expect(AppCatalog.resolve("com.example.elsewhere", in: [], lookup: lookup) == .resolved(elsewhere))
        // Display names are never looked up this way: only identifiers are unique.
        #expect(AppCatalog.resolve("Elsewhere", in: [], lookup: lookup) == .notFound)
    }

    @Test func scansTheRealSystem() {
        let apps = AppCatalog.scan()
        #expect(apps.contains { $0.id == "com.apple.finder" && $0.running })
        #expect(apps.contains { $0.id.lowercased() == "com.apple.calculator" })
        #expect(Set(apps.map { $0.id.lowercased() }).count == apps.count)
    }
}

@Suite struct CatalogMethodsTests {
    let dispatcher = Methods.standard(permissions: SystemPermissions())

    private func result(_ method: String, _ params: JSONValue) throws -> [String: Any] {
        let data = dispatcher.handle(id: "1", method: method, params: params)
        let reply = try #require(JSONSerialization.jsonObject(with: data.dropLast()) as? [String: Any])
        return try #require(reply["result"] as? [String: Any])
    }

    @Test func listsAppsInTheContractShape() throws {
        let listed = try result("list_apps", .object(["query": .string("finder"), "limit": .number(5)]))
        let apps = try #require(listed["apps"] as? [[String: Any]])
        #expect(apps.first?["id"] as? String == "com.apple.finder")
        #expect(apps.first?["running"] as? Bool == true)
        #expect(Set(apps.first?.keys.map { $0 } ?? []) == ["id", "name", "running"])
        #expect(listed["truncated"] as? Bool == false)
    }

    @Test func resolvesEachRequestedName() throws {
        let resolved = try result("resolve_apps", .object(["names": .array([.string("Finder"), .string("No Such App 1234")])]))
        let apps = try #require(resolved["apps"] as? [[String: Any]])
        #expect(apps[0]["status"] as? String == "resolved")
        #expect(apps[0]["id"] as? String == "com.apple.finder")
        #expect(apps[0]["request"] as? String == "Finder")
        #expect(apps[1]["status"] as? String == "not_found")
    }

    @Test func refusesMalformedParameters() throws {
        let data = dispatcher.handle(id: "1", method: "resolve_apps", params: .object(["names": .string("Finder")]))
        let reply = try #require(JSONSerialization.jsonObject(with: data.dropLast()) as? [String: Any])
        #expect((reply["error"] as? [String: String])?["code"] == "invalid_params")
    }
}
