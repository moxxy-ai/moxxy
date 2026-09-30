import AppKit

/// One application the model can name: its bundle identifier is the canonical `app` id.
public struct AppRecord: Equatable, Sendable {
    public let id: String
    public let name: String
    public let path: String?
    public let running: Bool

    public init(id: String, name: String, path: String?, running: Bool) {
        self.id = id
        self.name = name
        self.path = path
        self.running = running
    }

    var json: JSONValue { .object(["id": .string(id), "name": .string(name), "running": .bool(running)]) }
}

public enum Resolution: Equatable, Sendable {
    case resolved(AppRecord)
    case ambiguous([AppRecord])
    case notFound
}

public enum AppCatalog {
    static let directories = ["/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities",
                              NSHomeDirectory() + "/Applications"]

    /// Running apps win over installed copies of the same bundle; running first, then by name.
    public static func merge(running: [AppRecord], installed: [AppRecord]) -> [AppRecord] {
        var seen = Set<String>()
        let unique = (running + installed).filter { seen.insert($0.id.lowercased()).inserted }
        return unique.sorted { lhs, rhs in
            if lhs.running != rhs.running { return lhs.running }
            return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
        }
    }

    public static func page(_ apps: [AppRecord], query: String?, limit: Int) -> (apps: [AppRecord], truncated: Bool) {
        let needle = query?.lowercased() ?? ""
        let matching = needle.isEmpty ? apps : apps.filter { "\($0.name) \($0.id)".lowercased().contains(needle) }
        return (Array(matching.prefix(limit)), matching.count > limit)
    }

    /// Identifier first, then display name (with or without `.app`), then bundle path; last, `lookup`
    /// asks the system for an identifier installed outside the scanned folders.
    public static func resolve(_ request: String, in apps: [AppRecord], lookup: (String) -> AppRecord? = { _ in nil }) -> Resolution {
        let wanted = request.lowercased()
        if let byId = apps.first(where: { $0.id.lowercased() == wanted }) { return .resolved(byId) }
        let name = wanted.hasSuffix(".app") && !wanted.hasPrefix("/") ? String(wanted.dropLast(4)) : wanted
        let byName = apps.filter { $0.name.lowercased() == name }
        if byName.count == 1, let only = byName.first { return .resolved(only) }
        if byName.count > 1 { return .ambiguous(byName) }
        if let byPath = apps.first(where: { $0.path?.lowercased() == wanted }) { return .resolved(byPath) }
        if byName.isEmpty, request.contains("."), !request.contains("/"), let found = lookup(request) { return .resolved(found) }
        return .notFound
    }

    /// An app LaunchServices knows by identifier, wherever it is installed.
    static func registered(_ id: String) -> AppRecord? {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id), let bundle = Bundle(url: url),
              let bundleId = bundle.bundleIdentifier else { return nil }
        // The name the app shows when running, so a grant reads the same before and after launch.
        let name = (bundle.localizedInfoDictionary?["CFBundleDisplayName"] ?? bundle.infoDictionary?["CFBundleDisplayName"]
            ?? bundle.infoDictionary?["CFBundleName"]) as? String
        return AppRecord(id: bundleId, name: name ?? displayName(url), path: url.path, running: false)
    }

    public static func scan() -> [AppRecord] {
        let running = NSWorkspace.shared.runningApplications.compactMap { app -> AppRecord? in
            guard app.activationPolicy == .regular, let id = app.bundleIdentifier else { return nil }
            let name = app.localizedName ?? app.bundleURL.map(displayName) ?? id
            return AppRecord(id: id, name: name, path: app.bundleURL?.path, running: true)
        }
        return merge(running: running, installed: installed())
    }

    static func installed() -> [AppRecord] {
        directories.flatMap { directory -> [AppRecord] in
            let urls = (try? FileManager.default.contentsOfDirectory(at: URL(fileURLWithPath: directory), includingPropertiesForKeys: nil)) ?? []
            return urls.filter { $0.pathExtension == "app" }.compactMap { url in
                guard let id = Bundle(url: url)?.bundleIdentifier else { return nil }
                return AppRecord(id: id, name: displayName(url), path: url.path, running: false)
            }
        }
    }

    static func displayName(_ url: URL) -> String {
        let name = FileManager.default.displayName(atPath: url.path)
        return name.hasSuffix(".app") ? String(name.dropLast(4)) : name
    }
}

extension Methods {
    static func listApps(_ params: JSONValue) throws -> JSONValue {
        let limit = params["limit"]?.intValue ?? 50
        guard (1...200).contains(limit) else { throw HelperError.invalidParams("limit must be 1 to 200") }
        let page = AppCatalog.page(AppCatalog.scan(), query: params["query"]?.stringValue, limit: limit)
        return .object(["apps": .array(page.apps.map(\.json)), "truncated": .bool(page.truncated)])
    }

    static func resolveApps(_ params: JSONValue) throws -> JSONValue {
        guard case let .array(values)? = params["names"], values.count <= 32 else { throw HelperError.invalidParams("names must be a list of up to 32 names") }
        let names = values.compactMap(\.stringValue)
        guard names.count == values.count else { throw HelperError.invalidParams("names must be strings") }
        let apps = AppCatalog.scan()
        return .object(["apps": .array(names.map { request in
            switch AppCatalog.resolve(request, in: apps, lookup: AppCatalog.registered) {
            case let .resolved(app):
                return .object(["request": .string(request), "status": .string("resolved"), "id": .string(app.id), "name": .string(app.name)])
            case let .ambiguous(candidates):
                let refs = candidates.prefix(16).map { JSONValue.object(["id": .string($0.id), "name": .string($0.name)]) }
                return .object(["request": .string(request), "status": .string("ambiguous"), "candidates": .array(Array(refs))])
            case .notFound:
                return .object(["request": .string(request), "status": .string("not_found")])
            }
        })])
    }
}
