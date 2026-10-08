import Foundation
import Network

struct LANServer: Equatable {
    let name: String
    let origin: URL
}

/// Shared Foundation/Network core: can also be exercised on macOS without an iOS SDK.
final class LANDiscovery {
    var onServers: (([LANServer]) -> Void)?
    var onTrace: ((String) -> Void)?
    var onStatus: ((String) -> Void)?
    private var browser: NWBrowser?
    private var connections: [NWEndpoint: NWConnection] = [:]
    private var tasks: [UUID: URLSessionDataTask] = [:]
    private var serviceOrigins: [NWEndpoint: String] = [:]
    private var servers: [String: LANServer] = [:]
    private var attempted = Set<NWEndpoint>()
    private var generation = UUID()
    private let redirectGuard = LANRedirectGuard()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 4
        config.timeoutIntervalForResource = 6
        config.httpCookieStorage = nil
        config.urlCache = nil
        return URLSession(configuration: config, delegate: redirectGuard, delegateQueue: nil)
    }()

    static func localOrigin(_ text: String) -> URL? {
        guard let url = URL(string: text), url.scheme == "http",
              let host = url.host, isLocalHost(host), url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path == "" || url.path == "/",
              url.port == nil || (1...65535).contains(url.port!) else { return nil }
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        parts?.path = ""
        return parts?.url
    }

    static func isLocalHost(_ raw: String) -> Bool {
        let host = raw.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]."))
        if host == "localhost" || host.hasSuffix(".local") { return true }
        if let address = IPv4Address(host) {
            let b = Array(address.rawValue)
            return b[0] == 10 || b[0] == 127 || (b[0] == 192 && b[1] == 168)
                || (b[0] == 172 && (16...31).contains(Int(b[1])))
        }
        if let address = IPv6Address(host) {
            let b = Array(address.rawValue)
            return b[0] & 0xfe == 0xfc || b.dropLast().allSatisfy { $0 == 0 } && b.last == 1
        }
        return false
    }

    func start() {
        stop()
        let token = generation
        onStatus?("Ищем ноутбук мастера в Wi-Fi…")
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = false
        let next = NWBrowser(for: .bonjour(type: "_naryadai._tcp", domain: "local."), using: parameters)
        browser = next
        next.stateUpdateHandler = { [weak self] state in
            guard let self = self, self.generation == token else { return }
            self.onTrace?("browser state: \(state)")
            if case .failed = state { self.onStatus?("Поиск недоступен. Проверьте разрешение локальной сети в настройках iPhone.") }
            if case .waiting = state { self.onStatus?("Ждём сеть. Подключитесь к Wi-Fi ноутбука и разрешите доступ к локальной сети.") }
        }
        next.browseResultsChangedHandler = { [weak self] results, _ in
            guard let self = self, self.generation == token else { return }
            self.onTrace?("Bonjour services: \(results.count)")
            let active = Set(results.map { $0.endpoint })
            for endpoint in self.attempted.subtracting(active) {
                self.connections[endpoint]?.cancel(); self.connections.removeValue(forKey: endpoint)
                if let removed = self.serviceOrigins.removeValue(forKey: endpoint) { self.servers.removeValue(forKey: removed) }
            }
            self.attempted.formIntersection(active)
            self.onServers?(self.servers.values.sorted { $0.origin.absoluteString < $1.origin.absoluteString })
            for result in results {
                guard !self.attempted.contains(result.endpoint) else { continue }
                self.attempted.insert(result.endpoint)
                self.resolve(result.endpoint, token: token)
            }
        }
        next.start(queue: .main)
    }

    func stop() {
        generation = UUID()
        browser?.cancel(); browser = nil
        for connection in connections.values { connection.cancel() }
        connections.removeAll()
        for task in tasks.values { task.cancel() }
        tasks.removeAll(); servers.removeAll(); serviceOrigins.removeAll(); attempted.removeAll()
    }

    func probe(_ origin: URL, name: String = "Сохранённый сервер", requiredEndpoint: NWEndpoint? = nil, completion: ((LANServer?) -> Void)? = nil) {
        guard let safe = Self.localOrigin(origin.absoluteString) else { completion?(nil); return }
        let token = generation
        let endpoint = safe.appendingPathComponent("api/lan-discovery")
        var request = URLRequest(url: endpoint)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let taskID = UUID()
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.tasks.removeValue(forKey: taskID)
                guard self.generation == token, requiredEndpoint == nil || self.attempted.contains(requiredEndpoint!) else { return }
                self.onTrace?("probe response: \((response as? HTTPURLResponse)?.statusCode ?? 0), error: \(String(describing: error))")
                guard error == nil, let data = data, data.count <= 8192,
                      let response = response as? HTTPURLResponse, response.statusCode == 200,
                      response.url == endpoint,
                      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      object["app"] as? String == "naryadai", object["protocol"] as? Int == 1,
                      object["mode"] as? String == "shared-lan-demo" else { completion?(nil); return }
                let server = LANServer(name: name, origin: safe)
                self.servers[safe.absoluteString] = server
                self.onServers?(self.servers.values.sorted { $0.origin.absoluteString < $1.origin.absoluteString })
                completion?(server)
            }
        }
        tasks[taskID] = task; task.resume()
    }

    private func resolve(_ endpoint: NWEndpoint, token: UUID) {
        let connection = NWConnection(to: endpoint, using: .tcp)
        connections[endpoint] = connection
        connection.stateUpdateHandler = { [weak self, weak connection] state in
            guard let self = self, let connection = connection, self.generation == token else { return }
            self.onTrace?("resolve state: \(state)")
            switch state {
            case .ready:
                defer { connection.cancel(); if self.connections[endpoint] === connection { self.connections.removeValue(forKey: endpoint) } }
                self.onTrace?("resolved endpoint: \(String(describing: connection.currentPath?.remoteEndpoint))")
                guard case let .hostPort(host, port) = connection.currentPath?.remoteEndpoint else { return }
                let hostname: String
                switch host {
                case .ipv4(let address): hostname = address.rawValue.map { String($0) }.joined(separator: ".")
                case .ipv6(let address): hostname = String(address.debugDescription.split(separator: "%")[0])
                case .name(let name, _): hostname = name
                @unknown default: return
                }
                var components = URLComponents()
                components.scheme = "http"; components.host = hostname.contains(":") ? "[\(hostname)]" : hostname; components.port = Int(port.rawValue)
                guard let origin = components.url, Self.localOrigin(origin.absoluteString) != nil else { return }
                let name: String
                if case let .service(serviceName, _, _, _) = endpoint { name = serviceName } else { name = "Ноутбук мастера" }
                self.probe(origin, name: name, requiredEndpoint: endpoint) { [weak self] server in
                    guard let self = self, self.generation == token, self.attempted.contains(endpoint) else { return }
                    if let server = server { self.serviceOrigins[endpoint] = server.origin.absoluteString }
                }
            case .failed, .cancelled:
                connection.cancel(); if self.connections[endpoint] === connection { self.connections.removeValue(forKey: endpoint) }
            default: break
            }
        }
        connection.start(queue: .main)
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self, weak connection] in
            guard let self = self, self.generation == token else { return }
            connection?.cancel(); if self.connections[endpoint] === connection { self.connections.removeValue(forKey: endpoint) }
        }
    }
}

private final class LANRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
