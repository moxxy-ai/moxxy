import Foundation
import Testing
@testable import ComputerUseCore

@Suite struct NavigationTests {
    let home = "https://www.canva.com/"

    // Canva's "YouTube thumbnail" link creates the design before the editor loads: a page change is coming.
    @Test func aLinkToAnotherDocumentLeavesThePage() {
        #expect(Navigation.leaves(home, for: "https://www.canva.com/design/editor/shell?create&type=TACQ"))
        #expect(Navigation.leaves(nil, for: "http://example.com/next"))
    }

    @Test func aJumpWithinThePageOrAScriptDoesNotLeaveIt() {
        #expect(!Navigation.leaves(home, for: "https://www.canva.com/#templates"))
        #expect(!Navigation.leaves(home, for: "javascript:void(0)"))
        #expect(!Navigation.leaves(home, for: nil))
        #expect(!Navigation.leaves(home, for: "not a url"))
    }

    /// A browser that changes its page `after` seconds into the wait, on a clock the test moves.
    final class SlowBrowser {
        var clock = 0.0
        var looks = 0
        let after: Double
        let next: Navigation.Page
        let before = Navigation.Page(url: "https://www.canva.com/", title: "Strona główna – Canva")
        init(after: Double, next: Navigation.Page) { self.after = after; self.next = next }

        func awaited(deadline: Double = Navigation.deadline) -> Bool {
            Navigation.awaited(from: before, now: { self.clock }, read: { self.looks += 1; return self.clock >= self.after ? self.next : self.before },
                               pause: { self.clock += $0 }, deadline: deadline)
        }
    }

    @Test func waitsUntilTheNewPageShows() {
        let browser = SlowBrowser(after: 0.4, next: .init(url: "https://www.canva.com/design/DAH/edit", title: "Strona główna – Canva"))
        #expect(browser.awaited())
        #expect(browser.clock >= 0.4 && browser.clock < 1)
    }

    // Recorded by hand, Canva's page starts changing within half a second of the click. A link that opens
    // something in the page itself changes neither, and must not hold the action for long.
    @Test func waitsAtMostAFewSecondsByDefault() {
        let browser = SlowBrowser(after: .infinity, next: .init(url: nil, title: nil))
        #expect(!browser.awaited())
        #expect(browser.clock >= 3 && browser.clock < 3.5)
    }

    // A link that opens another tab changes the window's title even when its address is not readable.
    @Test func aNewTitleIsANewPageToo() {
        let browser = SlowBrowser(after: 1, next: .init(url: nil, title: "Projekt bez nazwy – Miniatura na YouTube"))
        #expect(browser.awaited())
    }

    @Test func givesUpAtTheDeadlineWhenThePageStaysTheSame() {
        let browser = SlowBrowser(after: .infinity, next: .init(url: nil, title: nil))
        #expect(!browser.awaited(deadline: 8))
        #expect(browser.clock >= 8 && browser.clock < 9)
    }

    // A window that cannot be read for a moment (the page is being replaced) is no answer either way.
    @Test func anUnreadableWindowIsNotAChange() {
        let before = Navigation.Page(url: "https://a.test/", title: "A")
        var clock = 0.0
        let changed = Navigation.awaited(from: before, now: { clock }, read: { clock < 2 ? nil : before }, pause: { clock += $0 }, deadline: 3)
        #expect(!changed)
    }
}
