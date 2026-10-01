import Testing
@testable import ComputerUseCore

@Suite struct ProtectedPathTests {
    private let home = "/Users/ann"
    private func refused(_ path: String) -> Bool { ProtectedPath.refuses(path, home: home) }

    @Test func refusesFoldersThatRunOrTrustWhatIsSavedInThem() {
        #expect(refused("/Users/ann/.ssh/config"))
        #expect(refused("~/.ssh"))
        #expect(refused("~/Library/LaunchAgents/com.evil.plist"))
        #expect(refused("/Library/LaunchDaemons/x.plist"))
        #expect(refused("/etc/hosts"))
        #expect(refused("/private/etc/sudoers.d/x"))
        #expect(refused("~/.config/fish/conf.d/x.fish"))
        #expect(refused("~/.gnupg/gpg.conf"))
    }

    @Test func refusesShellStartupFilesKeysAndGitInternals() {
        #expect(refused("~/.zshrc"))
        #expect(refused("/Users/ann/Projects/.bash_profile"))
        #expect(refused("authorized_keys"))
        #expect(refused("~/code/app/.git/hooks/pre-commit"))
        #expect(refused("~/code/app/.git/config"))
        #expect(refused("~/code/venv/bin/activate"))
    }

    @Test func refusesFilesThatRunWhenOpened() {
        #expect(refused("~/Desktop/Invoice.command"))
        #expect(refused("~/Downloads/link.webloc"))
        #expect(refused("profile.mobileconfig"))
    }

    @Test func seesThroughCaseSpacingAndLookAlikeCharacters() {
        #expect(refused("~/.SSH/config"))
        #expect(refused("~//.ssh///"))
        #expect(refused("~/Desktop/run.command. "))
        // A fullwidth dot (U+FF0E) folds to "." under NFKC.
        #expect(refused("~/\u{FF0E}zshrc"))
        // A zero-width space hidden in the name is ignored.
        #expect(refused("~/.zsh\u{200B}rc"))
    }

    @Test func allowsOrdinaryDocuments() {
        #expect(!refused("~/Documents/Report.txt"))
        #expect(!refused("/Users/ann/Desktop/notes.md"))
        #expect(!refused("Untitled.rtf"))
        #expect(!refused("~/code/app/hooks/pre-commit.md"))
        #expect(!refused("~/ssh-notes.txt"))
    }
}

@Suite struct SaveGuardTests {
    private let home = "/Users/ann"

    @Test func checksWhatIsTypedIntoTheNameAndGoToFields() {
        #expect(SaveGuard.refusesTyping(".zshrc", into: "saveAsNameTextField", home: home))
        #expect(SaveGuard.refusesTyping("~/.ssh/config", into: "saveAsNameTextField", home: home))
        #expect(SaveGuard.refusesTyping("~/Library/LaunchAgents", into: "PathTextField", home: home))
        #expect(!SaveGuard.refusesTyping("Report", into: "saveAsNameTextField", home: home))
        // Other fields are not part of a save dialog's destination.
        #expect(!SaveGuard.refusesTyping(".zshrc", into: "name", home: home))
        #expect(!SaveGuard.refusesTyping(".zshrc", into: nil, home: home))
    }

    @Test func refusesConfirmingASaveIntoAProtectedPlace() {
        #expect(SaveGuard.refusesSaving(name: "authorized_keys", folder: "Documents", home: home))
        // The Where menu shows only the folder's name.
        #expect(SaveGuard.refusesSaving(name: "config", folder: ".ssh", home: home))
        #expect(SaveGuard.refusesSaving(name: "x.plist", folder: "LaunchAgents", home: home))
        #expect(SaveGuard.refusesSaving(name: "pre-commit", folder: "hooks", home: home))
        #expect(!SaveGuard.refusesSaving(name: "Report", folder: "Documents", home: home))
        #expect(!SaveGuard.refusesSaving(name: nil, folder: nil, home: home))
    }
}
