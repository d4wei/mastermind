// Usage: winwatch <owner-name> <title-substring> <timeout_s>: prints "<pid> <ms>" when a window of
// that owner, on screen, layer 0, taller than 100 pt, has a title containing the substring, or
// "-1 -1" on timeout. Windows already on screen at start are ignored, so a mastermind the user has
// open does not answer for the host being measured.
import CoreGraphics
import Foundation
let name = CommandLine.arguments[1]
let needle = CommandLine.arguments[2]
let timeout = Double(CommandLine.arguments[3])!
let start = Date()
func windows() -> [[String: Any]] {
  (CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]) ?? []
}
let existing = Set(windows().compactMap { $0[kCGWindowNumber as String] as? Int })
while Date().timeIntervalSince(start) < timeout {
  for w in windows() where (w[kCGWindowOwnerName as String] as? String) == name && (w[kCGWindowLayer as String] as? Int) == 0 {
    guard let number = w[kCGWindowNumber as String] as? Int, !existing.contains(number) else { continue }
    let title = (w[kCGWindowName as String] as? String) ?? ""
    if let b = w[kCGWindowBounds as String] as? [String: Any], let h = b["Height"] as? Double, h > 100,
       needle.isEmpty || title.contains(needle) {
      print("\(w[kCGWindowOwnerPID as String]!) \(Int(Date().timeIntervalSince(start)*1000))"); exit(0)
    }
  }
  usleep(4000)
}
print("-1 -1")
