import Foundation

/// Places a save dialog must never write to: what is saved there runs on its own or is trusted later
/// (login items, shell start-up, SSH and GPG keys, git hooks, files that run when opened). The lists
/// follow the ones Claude uses for its save panels; the matching is ours.
public enum ProtectedPath {
    /// Folders under the home folder, refused with everything inside them.
    static let homeFolders = [
        ".ssh", ".gnupg", ".aws", ".kube", ".docker", ".hammerspoon", ".zsh_sessions", ".bash_sessions",
        "library/launchagents", "library/launchdaemons", ".config/git", ".config/fish", ".local/share/fish",
    ]
    static let systemFolders = ["/etc", "/private/etc", "/library/launchagents", "/library/launchdaemons", "/system"]
    /// Refused wherever they would be saved.
    static let names: Set<String> = [
        ".zshrc", ".zshenv", ".zprofile", ".zlogin", ".zlogout", ".bashrc", ".bash_profile", ".bash_login", ".bash_logout",
        ".profile", ".gitconfig", "authorized_keys", "known_hosts", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
    ]
    /// Opening one of these runs or installs something.
    static let extensions: Set<String> = [
        "command", "tool", "terminal", "term", "fileloc", "inetloc", "webloc", "ftploc", "afploc", "smbloc", "vncloc",
        "mailloc", "newsloc", "mobileconfig",
    ]
    static let gitInternals: Set<String> = ["config", "config.worktree", "gitdir", "commondir"]

    /// `path` may be absolute, start with `~`, or be a bare file name typed into a save dialog.
    public static func refuses(_ path: String, home: String) -> Bool {
        let parts = normalized(path, home: normalized(home, home: "")).split(separator: "/").map(String.init)
        guard let name = parts.last else { return false }
        if names.contains(name) { return true }
        if let dot = name.lastIndex(of: "."), extensions.contains(String(name[name.index(after: dot)...])) { return true }
        if let git = parts.firstIndex(of: ".git") {
            let inside = parts[(git + 1)...]
            if inside.isEmpty || inside.first == "hooks" || (inside.count == 1 && gitInternals.contains(name)) { return true }
        }
        if parts.count >= 2, parts[parts.count - 2] == "bin", name.hasPrefix("activate") { return true }
        let full = "/" + parts.joined(separator: "/")
        let homeRoot = normalized(home, home: "")
        let folders = systemFolders + homeFolders.map { homeRoot + "/" + $0 }
        return folders.contains { full == $0 || full.hasPrefix($0 + "/") }
    }

    /// Folded the way a file system that ignores case sees it: NFKC, invisible characters removed, lower case,
    /// `~` expanded, repeated and trailing slashes dropped, trailing dots and spaces dropped from each part.
    static func normalized(_ path: String, home: String) -> String {
        var text = path.precomposedStringWithCompatibilityMapping
        text.unicodeScalars.removeAll { $0.properties.isDefaultIgnorableCodePoint }
        text = text.lowercased().trimmingCharacters(in: .whitespaces)
        if text == "~" { text = home } else if text.hasPrefix("~/") { text = home + text.dropFirst() }
        let parts = text.split(separator: "/").map { part in
            String(part).replacingOccurrences(of: "[. ]+$", with: "", options: .regularExpression)
        }.filter { !$0.isEmpty }
        return (text.hasPrefix("/") ? "/" : "") + parts.joined(separator: "/")
    }
}

/// The save dialog (`NSSavePanel`) seen through accessibility: its name field takes names and paths, its
/// Go To field a folder, and its Where menu names the folder only by its last component.
public enum SaveGuard {
    static let panel = "save-panel"
    static let nameField = "saveAsNameTextField"
    static let goToField = "PathTextField"
    static let whereMenu = "where popup"
    static let saveButton = "OKButton"

    /// Folder names the Where menu may show for a protected place.
    static let folderNames: Set<String> = Set(
        (ProtectedPath.homeFolders + ProtectedPath.systemFolders).compactMap { $0.split(separator: "/").last.map(String.init) }
    ).union(["hooks", ".git"])

    public static func refusesTyping(_ text: String, into field: String?, home: String) -> Bool {
        guard field == nameField || field == goToField else { return false }
        return ProtectedPath.refuses(text, home: home)
    }

    public static func refusesSaving(name: String?, folder: String?, home: String) -> Bool {
        if let name, ProtectedPath.refuses(name, home: home) { return true }
        guard let folder else { return false }
        return folderNames.contains(ProtectedPath.normalized(folder, home: home))
    }
}
