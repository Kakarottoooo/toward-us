import Foundation

enum PinkyLanguage: String, CaseIterable, Identifiable, Codable {
    case zh, en, es

    var id: String { rawValue }
    var label: String { rawValue.uppercased() }

    static var preferred: Self {
        let first = Locale.preferredLanguages.first ?? "en"
        if first.hasPrefix("zh") { return .zh }
        if first.hasPrefix("es") { return .es }
        return .en
    }

    func text(_ zh: String, _ en: String, _ es: String) -> String {
        switch self {
        case .zh: return zh
        case .en: return en
        case .es: return es
        }
    }
}

struct PinkyStroke: Codable, Equatable {
    var color: String
    var points: [[Int]]
}

struct PinkyAPIError: LocalizedError {
    let statusCode: Int
    let message: String
    var errorDescription: String? { message }
}

struct PinkyUser: Decodable, Equatable, Identifiable {
    let id: String
    let email: String
    let name: String
    let aiConsentAt: String?
}

struct PinkyPairing: Decodable, Equatable {
    struct Member: Decodable, Equatable, Identifiable {
        let id: String
        let name: String
    }

    struct Invitation: Decodable, Equatable {
        let code: String
        let expiresAt: String?
    }

    let id: String
    let status: String
    let members: [Member]
    let invitation: Invitation?
    var active: Bool { status == "active" && members.count == 2 }
}

struct PinkyIdentity: Decodable, Equatable {
    let user: PinkyUser?
    let pairing: PinkyPairing?
}

struct PinkyPairingResponse: Decodable {
    let pairing: PinkyPairing?
}

struct PinkyAPI: Sendable {
    let baseURL: URL
    private let session: URLSession
    private let restoreSession: URLSession

    static let production = PinkyAPI(baseURL: URL(string: "https://toward-us-private-beta.onrender.com")!)

    static var configured: PinkyAPI {
        #if DEBUG
        // An isolated local server can be used by the simulator. Release builds use the same production host.
        if let value = ProcessInfo.processInfo.environment["PINKY_LOCAL_API"],
           let url = URL(string: value), url.scheme == "http",
           ["127.0.0.1", "localhost"].contains(url.host ?? ""),
           url.user == nil, url.password == nil {
            return PinkyAPI(baseURL: url)
        }
        #endif
        return .production
    }

    init(baseURL: URL) {
        self.baseURL = baseURL
        session = Self.makeSession(baseURL: baseURL, requestTimeout: 75, resourceTimeout: 180)
        restoreSession = Self.makeSession(baseURL: baseURL, requestTimeout: 6, resourceTimeout: 8)
    }

    private static func makeSession(baseURL: URL, requestTimeout: TimeInterval, resourceTimeout: TimeInterval) -> URLSession {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpShouldSetCookies = true
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.urlCache = nil
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = resourceTimeout
        return URLSession(configuration: config, delegate: PinkyRedirectPolicy(base: baseURL), delegateQueue: nil)
    }

    var hasSessionCookie: Bool {
        let url = baseURL.appending(path: "api/auth/me")
        return HTTPCookieStorage.shared.cookies(for: url)?.contains { $0.name == "toward_us_session" } == true
    }

    func restoreIdentity() async throws -> PinkyIdentity {
        let bytes = try await request("/api/auth/me", using: restoreSession)
        return try JSONDecoder().decode(PinkyIdentity.self, from: bytes)
    }

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        try JSONDecoder().decode(T.self, from: await data(path, query: query))
    }

    func post<Body: Encodable, T: Decodable>(_ path: String, body: Body) async throws -> T {
        let bytes = try await request(path, method: "POST", payload: JSONEncoder().encode(body), contentType: "application/json")
        return try JSONDecoder().decode(T.self, from: bytes)
    }

    func send<Body: Encodable>(_ path: String, body: Body) async throws {
        _ = try await request(path, method: "POST", payload: JSONEncoder().encode(body), contentType: "application/json")
    }

    func delete<Body: Encodable>(_ path: String, body: Body) async throws {
        _ = try await request(path, method: "DELETE", payload: JSONEncoder().encode(body), contentType: "application/json")
    }

    func data(_ path: String, query: [URLQueryItem] = []) async throws -> Data {
        try await request(path, query: query)
    }

    func upload<T: Decodable>(_ path: String, data: Data, contentType: String) async throws -> T {
        let bytes = try await request(path, method: "POST", payload: data, contentType: contentType)
        return try JSONDecoder().decode(T.self, from: bytes)
    }

    func invitationURL(code: String) -> URL {
        var parts = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        parts.path = "/"
        parts.queryItems = [URLQueryItem(name: "invite", value: code)]
        return parts.url!
    }

    func clearSession() {
        let storage = HTTPCookieStorage.shared
        for cookie in storage.cookies(for: baseURL) ?? [] {
            storage.deleteCookie(cookie)
        }
    }

    private func request(
        _ path: String,
        method: String = "GET",
        query: [URLQueryItem] = [],
        payload: Data? = nil,
        contentType: String? = nil,
        using requestSession: URLSession? = nil
    ) async throws -> Data {
        guard path.hasPrefix("/api/"),
              let endpoint = URLComponents(string: path), endpoint.host == nil,
              endpoint.scheme == nil, endpoint.fragment == nil,
              var target = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw PinkyAPIError(statusCode: 0, message: "Invalid Pinky endpoint.")
        }
        target.percentEncodedPath = endpoint.percentEncodedPath
        let params = (endpoint.queryItems ?? []) + query
        target.queryItems = params.isEmpty ? nil : params
        guard let url = target.url else {
            throw PinkyAPIError(statusCode: 0, message: "Invalid Pinky endpoint.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = payload
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        if let contentType { request.setValue(contentType, forHTTPHeaderField: "Content-Type") }

        let (data, incoming) = try await (requestSession ?? session).data(for: request)
        guard let response = incoming as? HTTPURLResponse else {
            throw PinkyAPIError(statusCode: 0, message: "Pinky sent an unexpected response.")
        }
        guard (200..<300).contains(response.statusCode) else {
            let serverMessage = try? JSONDecoder().decode(ErrorEnvelope.self, from: data)
            throw PinkyAPIError(statusCode: response.statusCode,
                                message: serverMessage?.error ?? HTTPURLResponse.localizedString(forStatusCode: response.statusCode))
        }
        return data
    }

    private struct ErrorEnvelope: Decodable { let error: String }
}

private final class PinkyRedirectPolicy: NSObject, URLSessionTaskDelegate {
    private let base: URL
    init(base: URL) { self.base = base }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        let url = request.url
        let allowed = url?.scheme == base.scheme && url?.host == base.host && url?.port == base.port
        completionHandler(allowed ? request : nil)
    }
}
