import Foundation
import Network

let cases: [(String, Bool)] = [
    ("http://192.168.1.120:8788", true), ("http://10.1.2.3:8788/", true),
    ("http://172.16.1.2:8788", true), ("http://laptop.local:8788", true),
    ("http://[fd00::1]:8788", true), ("http://127.0.0.1:8788", true),
    ("https://192.168.1.120:8788", false), ("http://example.com", false),
    ("http://8.8.8.8:8788", false), ("http://172.32.1.1:8788", false),
    ("http://user:secret@laptop.local:8788", false), ("http://laptop.local:8788/demo", false),
    ("http://laptop.local:8788?token=x", false), ("http://laptop.local:8788#x", false)
]
for (text, expected) in cases { precondition((LANDiscovery.localOrigin(text) != nil) == expected, text) }
print("PASS: 14 local-origin validation cases")
let discovery = LANDiscovery()
discovery.onTrace = { print($0) }
discovery.onStatus = { print($0) }
discovery.onServers = { servers in
    guard let server = servers.first else { return }
    print("PASS: NWBrowser resolved Bonjour service + verified LAN protocol: \(server.name) \(server.origin)")
    discovery.stop()
    exit(0)
}
discovery.start()
DispatchQueue.main.asyncAfter(deadline: .now() + 18) { print("FAIL: native discovery timed out"); discovery.stop(); exit(1) }
dispatchMain()
