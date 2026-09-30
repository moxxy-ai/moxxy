// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "MoxxyComputer",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "moxxy-computer", targets: ["moxxy-computer"]),
    ],
    targets: [
        // Everything testable lives in the library; the executable only wires stdio, the parent watch and AppKit.
        .target(name: "ComputerUseCore"),
        .executableTarget(name: "moxxy-computer", dependencies: ["ComputerUseCore"]),
        .testTarget(name: "ComputerUseCoreTests", dependencies: ["ComputerUseCore"]),
    ]
)
