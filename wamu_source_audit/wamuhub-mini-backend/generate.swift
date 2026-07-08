import Foundation

let output = "Output/InvoiceForge"
let fm = FileManager.default
try? fm.createDirectory(atPath: "\(output)/Sources/InvoiceForge", withIntermediateDirectories: true)

let package = """
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "InvoiceForge",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "InvoiceForge", targets: ["InvoiceForge"])
    ],
    dependencies: [
        .package(path: "../CommerceKernel")
    ],
    targets: [
        .executableTarget(
            name: "InvoiceForge",
            dependencies: ["CommerceKernel"]
        )
    ]
)
"""

let main = """
import CommerceKernel
import SwiftUI

@main
struct InvoiceForgeApp: App {
    var body: some Scene {
        WindowGroup {
            Text("InvoiceForge v1.0")
                .padding()
                .frame(width: 400, height: 300)
        }
    }
}
"""

try package.write(toFile: "\(output)/Package.swift", atomically: true, encoding: .utf8)
try main.write(toFile: "\(output)/Sources/InvoiceForge/main.swift", atomically: true, encoding: .utf8)

print("✅ InvoiceForge project generated at \(output)")
print("Next: cd \(output) && swift build -c release")