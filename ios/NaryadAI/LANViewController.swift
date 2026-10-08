import UIKit
import WebKit

final class LANViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let discovery = LANDiscovery()
    private var web: WKWebView?
    private var origin: URL?
    private var servers: [LANServer] = []
    private var generation = UUID()
    private var autoSelection: DispatchWorkItem?
    private var retry: Timer?
    private var heartbeat: Timer?
    private var failedChecks = 0
    private var stack = UIStackView()
    private let status = UILabel()
    private let preferredKey = "naryadai.lan-server"
    private var pendingSave = false

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "НарядAI · Wi-Fi"
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItems = [
            UIBarButtonItem(title: "Сервер", style: .plain, target: self, action: #selector(changeServer)),
            UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(reload))
        ]
        discovery.onStatus = { [weak self] text in self?.status.text = text }
        discovery.onServers = { [weak self] found in self?.updateServers(found) }
        NotificationCenter.default.addObserver(self, selector: #selector(active), name: UIApplication.didBecomeActiveNotification, object: nil)
        search()
    }

    @objc private func active() { if web == nil { search() } }
    @objc private func reload() { if let web = web { web.reload() } else { search() } }
    @objc private func changeServer() { UserDefaults.standard.removeObject(forKey: preferredKey); search() }

    private func label(_ text: String, size: CGFloat) -> UILabel {
        let label = UILabel(); label.text = text; label.numberOfLines = 0
        label.font = .systemFont(ofSize: size); label.textColor = .label
        return label
    }
    private func button(_ text: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(text, for: .normal); button.titleLabel?.numberOfLines = 0
        button.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        button.backgroundColor = .secondarySystemBackground; button.layer.cornerRadius = 12
        button.contentEdgeInsets = UIEdgeInsets(top: 14, left: 12, bottom: 14, right: 12)
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }
    private func search() {
        generation = UUID(); autoSelection?.cancel(); retry?.invalidate(); heartbeat?.invalidate()
        web?.stopLoading(); web?.configuration.userContentController.removeScriptMessageHandler(forName: "naryad")
        web?.navigationDelegate = nil; web?.uiDelegate = nil; web?.removeFromSuperview(); web = nil; origin = nil
        servers.removeAll()
        for child in view.subviews { child.removeFromSuperview() }
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        stack = UIStackView(); stack.axis = .vertical; stack.spacing = 18; stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 28),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48)
        ])
        stack.addArrangedSubview(label("Общая смена на iPhone", size: 28))
        status.numberOfLines = 0; status.font = .systemFont(ofSize: 18); stack.addArrangedSubview(status)
        stack.addArrangedSubview(label("Подключитесь к Wi-Fi ноутбука. На ноутбуке запустите Start-LAN. Разрешите приложению доступ к локальной сети — оно само найдёт сервер.", size: 17))
        stack.addArrangedSubview(button("Повторить поиск") { [weak self] in self?.search() })
        stack.addArrangedSubview(button("Указать адрес вручную") { [weak self] in self?.manual() })
        discovery.start()
        let token = generation
        if let text = UserDefaults.standard.string(forKey: preferredKey), let saved = LANDiscovery.localOrigin(text) {
            discovery.probe(saved) { [weak self] server in
                guard let self = self, self.generation == token, self.web == nil, let server = server else { return }
                self.connect(server)
            }
        }
        retry = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            guard let self = self, self.web == nil, self.servers.isEmpty, UIApplication.shared.applicationState == .active else { return }
            self.search()
        }
    }
    private func updateServers(_ found: [LANServer]) {
        guard web == nil else { return }
        servers = found; autoSelection?.cancel()
        for arranged in stack.arrangedSubviews.filter({ $0.tag == 42 }) { stack.removeArrangedSubview(arranged); arranged.removeFromSuperview() }
        if found.isEmpty { status.text = "Ищем доступный сервер в Wi-Fi…" }
        if found.count > 1 {
            status.text = "Найдено несколько ноутбуков. На всех телефонах выберите один сервер."
            // Keep one set of selection controls; repeated service updates replace the previous set.
            for server in found {
                let select = button(server.name + "\n" + server.origin.absoluteString) { [weak self] in self?.connect(server) }
                select.tag = 42; stack.addArrangedSubview(select)
            }
        } else if let server = found.first {
            status.text = "Сервер найден. Подключаемся…"
            let token = generation
            let action = DispatchWorkItem { [weak self] in
                guard let self = self, self.generation == token, self.web == nil, self.servers.count == 1 else { return }
                self.connect(server)
            }
            autoSelection = action; DispatchQueue.main.asyncAfter(deadline: .now() + 3.5, execute: action)
        }
    }
    private func manual() {
        let alert = UIAlertController(title: "Адрес ноутбука", message: "Адрес показан в Start-LAN. Например: http://192.168.1.10:8788", preferredStyle: .alert)
        alert.addTextField { input in input.text = UserDefaults.standard.string(forKey: self.preferredKey) ?? "http://"; input.keyboardType = .URL; input.autocapitalizationType = .none; input.autocorrectionType = .no }
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel))
        alert.addAction(UIAlertAction(title: "Подключиться", style: .default) { [weak self, weak alert] _ in
            guard let self = self else { return }
            guard let text = alert?.textFields?.first?.text, let url = LANDiscovery.localOrigin(text.trimmingCharacters(in: .whitespacesAndNewlines)) else { self.status.text = "Нужен HTTP-адрес локальной сети без пути и пароля."; return }
            let token = self.generation
            self.discovery.probe(url) { [weak self] server in
                guard let self = self, self.generation == token, self.web == nil else { return }
                if let server = server { self.connect(server) } else { self.status.text = "По этому адресу нет доступного демо-сервера НарядAI. Проверьте Wi-Fi и Start-LAN." }
            }
        })
        present(alert, animated: true)
    }

    private func connect(_ server: LANServer) {
        guard web == nil else { return }
        autoSelection?.cancel(); retry?.invalidate(); discovery.stop()
        origin = server.origin; UserDefaults.standard.set(server.origin.absoluteString, forKey: preferredKey)
        for child in view.subviews { child.removeFromSuperview() }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(WeakMessageHandler(self), name: "naryad")
        config.userContentController.addUserScript(WKUserScript(source: Self.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let browser = WKWebView(frame: .zero, configuration: config)
        browser.translatesAutoresizingMaskIntoConstraints = false; browser.navigationDelegate = self; browser.uiDelegate = self
        browser.allowsBackForwardNavigationGestures = true
        web = browser; view.addSubview(browser)
        NSLayoutConstraint.activate([
            browser.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor), browser.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            browser.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), browser.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        browser.load(URLRequest(url: server.origin.appendingPathComponent("demo")))
        failedChecks = 0
        heartbeat = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            guard let self = self, self.web != nil, UIApplication.shared.applicationState == .active else { return }
            let token = self.generation
            self.discovery.probe(server.origin) { [weak self] result in
                guard let self = self, self.generation == token, self.web != nil else { return }
                self.failedChecks = result == nil ? self.failedChecks + 1 : 0
                if self.failedChecks >= 2 { self.search() }
            }
        }
    }
    private func sameServer(_ url: URL) -> Bool {
        guard let origin = origin else { return false }
        return url.scheme == origin.scheme && url.host?.lowercased() == origin.host?.lowercased() && (url.port ?? 80) == (origin.port ?? 80)
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard webView === web, let url = action.request.url else { decisionHandler(.cancel); return }
        if sameServer(url) || url.scheme == "blob" && action.targetFrame?.isMainFrame != false { decisionHandler(.allow); return }
        if action.navigationType == .linkActivated, action.targetFrame?.isMainFrame != false, url.scheme == "https" { UIApplication.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { recover(webView, error: error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { recover(webView, error: error) }
    private func recover(_ browser: WKWebView, error: Error) {
        if browser === web && (error as NSError).code != NSURLErrorCancelled { search() }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "НарядAI", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() }); present(alert, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "НарядAI", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Отмена", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Продолжить", style: .default) { _ in completionHandler(true) }); present(alert, animated: true)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let source = message.frameInfo.request.url, sameServer(source),
              let body = message.body as? [String: String], web != nil else { return }
        if body["action"] == "print", let browser = web {
            let printer = UIPrintInteractionController.shared; printer.printFormatter = browser.viewPrintFormatter()
            printer.present(animated: true, completionHandler: nil)
        } else if body["action"] == "save", !pendingSave, let encoded = body["data"], encoded.count <= 16_777_216,
                  let bytes = Data(base64Encoded: encoded), bytes.count <= 12_582_912 {
            let raw = body["name"] ?? "NaryadAI-export.xlsx"
            let name = String(raw.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|")).joined(separator: "_").prefix(120))
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let file = folder.appendingPathComponent(name.isEmpty ? "NaryadAI-export.xlsx" : name)
                try bytes.write(to: file, options: .atomic)
                pendingSave = true
                let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                share.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItems?.first
                share.completionWithItemsHandler = { [weak self] _, _, _, _ in self?.pendingSave = false; try? FileManager.default.removeItem(at: folder) }
                present(share, animated: true)
            } catch { status.text = "Не удалось сохранить файл." }
        }
    }
    private static let bridge = """
    (()=>{ const post=b=>window.webkit.messageHandlers.naryad.postMessage(b);
      window.NaryadIOS={saveFile:(name,mime,data)=>post({action:'save',name,mime,data})};
      window.print=()=>post({action:'print'});
    })();
    """
    deinit { retry?.invalidate(); heartbeat?.invalidate(); discovery.stop(); NotificationCenter.default.removeObserver(self) }
}

private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { target?.userContentController(userContentController, didReceive: message) }
}
