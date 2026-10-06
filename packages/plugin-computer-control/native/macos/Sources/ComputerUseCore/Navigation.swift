import ApplicationServices
import Foundation

/// A click on a link to another page: the browser may take seconds before the page changes at all (Canva creates
/// the design first, then loads its editor), and a look in between says the click did nothing, which invites
/// a second click that starts the same thing again.
public enum Navigation {
    /// A page that changes at all starts within half a second of a real click; this only caps the wait for one that does not.
    public static let deadline: Double = 3
    /// The longest pause between looks when the app sends no notification.
    static let backstop: Double = 0.5

    /// What a page is to tell it from the next one: the document's address and the window's title.
    public struct Page: Equatable, Sendable {
        public let url: String?
        public let title: String?
        public init(url: String?, title: String?) {
            self.url = url
            self.title = title
        }
    }

    /// Whether following `link` leaves `page` for another document: a jump within the page or a script does not.
    public static func leaves(_ page: String?, for link: String?) -> Bool {
        guard let link, let target = URLComponents(string: link), ["http", "https"].contains(target.scheme?.lowercased() ?? "") else { return false }
        guard let page, let current = URLComponents(string: page) else { return true }
        return withoutFragment(target) != withoutFragment(current)
    }

    private static func withoutFragment(_ address: URLComponents) -> URL? {
        var copy = address
        copy.fragment = nil
        return copy.url
    }

    /// Looks until the page is another one, pausing in between, and says whether it changed before `deadline`.
    public static func awaited(from before: Page, now: () -> Double, read: () -> Page?, pause: (Double) -> Void, deadline: Double = deadline) -> Bool {
        let end = now() + deadline
        while now() < end {
            if let page = read(), page != before { return true }
            pause(min(backstop, max(0, end - now())))
        }
        return false
    }

    /// The page the link at `element` would leave, when it is a link to another document; `nil` otherwise.
    static func leaving(from element: AXUIElement, window: AXUIElement) -> Page? {
        let lineage = AXReader.lineage(element, limit: 80)
        let link = lineage.prefix(6).first { AXReader.attribute($0, kAXRoleAttribute) == "AXLink" }
        guard let link, let page = lineage.first(where: { AXReader.attribute($0, kAXRoleAttribute) == "AXWebArea" }) else { return nil }
        let before = Page(url: address(page), title: AXReader.attribute(window, kAXTitleAttribute))
        return leaves(before.url, for: address(link)) ? before : nil
    }

    /// The page the app shows now, in whichever window is in front of it: a link may open a new one.
    static func current(pid: pid_t) -> Page? {
        guard let window = AXReader.targetWindow(of: AXReader.application(pid)) else { return nil }
        return Page(url: webArea(below: window, depth: 0).flatMap(address), title: AXReader.attribute(window, kAXTitleAttribute))
    }

    private static func address(_ element: AXUIElement) -> String? {
        let url: URL? = AXReader.attribute(element, kAXURLAttribute)
        return url?.absoluteString
    }

    /// A role-only walk: the page sits a few levels below the window, under the browser's own controls.
    private static func webArea(below element: AXUIElement, depth: Int) -> AXUIElement? {
        guard depth < 12 else { return nil }
        let children: [AXUIElement] = AXReader.attribute(element, kAXChildrenAttribute) ?? []
        if let area = children.first(where: { AXReader.attribute($0, kAXRoleAttribute) == "AXWebArea" }) { return area }
        return children.lazy.compactMap { webArea(below: $0, depth: depth + 1) }.first
    }
}
