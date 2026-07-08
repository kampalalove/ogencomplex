// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "InvoiceForge",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "InvoiceForge", targets: ["InvoiceForge"])
    ],
    dependencies: [
        .package(path: "../../CommerceKernel")
    ],
    targets: [
        .executableTarget(
            name: "InvoiceForge",
            dependencies: ["CommerceKernel"]
        )
    ]
)