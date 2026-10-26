package dev.relaydeck.mobile;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

/**
 * WSS relay transport. The relay forwards JSON envelopes and opaque
 * AES-GCM frames only; the gateway token travels inside the encrypted body.
 */
final class RelayTransport {
    static final int MAX_JSON_BYTES = RemoteApi.MAX_JSON_BYTES;
    static final int MAX_FILE_BYTES = 32 * 1024 * 1024;
    // A file is base64 encoded inside the encrypted JSON envelope, so the
    // encrypted stream is larger than the file itself.
    static final int MAX_FILE_ENVELOPE_BYTES = 48 * 1024 * 1024;
    private static final String PROTOCOL_VERSION = "1";

    private final String relayUrl;
    private final String machineId;
    private final String machinePublicKey;
    private final String machineFingerprint;
    private final String connectionKey;
    private final OkHttpClient client;
    private final Map<String, Stream> streams = new ConcurrentHashMap<>();
    private final Object connectSignal = new Object();
    private final ExecutorService heartbeat = Executors.newSingleThreadExecutor();

    private volatile String credential;
    private volatile String pairedCredential;
    private volatile String bearerToken;
    private volatile WebSocket socket;
    private volatile KeyPair ephemeral;
    private volatile String deviceNonce = "";
    private volatile byte[] sendKey;
    private volatile byte[] receiveKey;
    private volatile String sessionId = "";
    private volatile String state = "idle";
    private volatile String lastError = "";
    private volatile boolean closed;
    private volatile boolean heartbeatStarted;
    private volatile long lastPongAt;
    private final java.util.concurrent.atomic.AtomicLong generation = new java.util.concurrent.atomic.AtomicLong();

    static final class RelayException extends Exception {
        final int status;
        RelayException(int status, String message) { super(message); this.status = status; }
    }

    RelayTransport(String relayUrl, String machineId, String machinePublicKey, String machineFingerprint,
                   String credential, String ticket, String bearerToken) throws Exception {
        URI uri = new URI(relayUrl);
        if (!"wss".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
            || uri.getQuery() != null || uri.getFragment() != null) throw new Exception("Relay 地址必须是 wss://域名/路径");
        if (machineId == null || !machineId.matches("[A-Za-z0-9_-]{16,80}")) throw new Exception("Relay 机器 ID 无效");
        if (machinePublicKey == null || machinePublicKey.isEmpty()) throw new Exception("Relay 配对信息缺少电脑公钥");
        String pinned = RelayCrypto.fingerprint(machinePublicKey);
        if (machineFingerprint == null || !machineFingerprint.matches("[a-fA-F0-9]{64}")
            || !pinned.equalsIgnoreCase(machineFingerprint)) throw new Exception("Relay 电脑公钥指纹不匹配");
        if ((credential == null || credential.length() < 24) && (ticket == null || ticket.length() < 24))
            throw new Exception("Relay 配对票据或设备凭据无效");
        this.relayUrl = uri.toString();
        this.machineId = machineId;
        this.machinePublicKey = machinePublicKey;
        this.machineFingerprint = pinned;
        this.credential = credential == null ? "" : credential;
        this.pairedCredential = this.credential;
        this.bearerToken = bearerToken == null ? "" : bearerToken;
        this.connectionKey = relayUrl + "\n" + machineId + "\n" + pinned;
        OkHttpClient base = RemoteApi.httpClient();
        this.client = base.newBuilder()
            .connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(20, TimeUnit.SECONDS)
            .build();
        if (ticket != null && !ticket.isEmpty()) {
            this.ticket = ticket;
        } else {
            this.ticket = "";
        }
    }

    private volatile String ticket;

    String key() { return connectionKey; }
    String status() { return state; }
    String lastError() { return lastError; }
    boolean connected() { return "online".equals(state) && sendKey != null; }
    String issuedCredential() { return credential; }
    boolean credentialChanged() { return credential != null && !credential.isEmpty() && !credential.equals(pairedCredential); }
    void bearerToken(String value) { bearerToken = value == null ? "" : value; }
    long generation() { return generation.get(); }

    void connect(long timeoutMs) throws Exception {
        if (connected()) return;
        synchronized (connectSignal) {
            closeSocket();
            closed = false;
            state = "connecting";
            lastError = "";
            sendKey = null;
            receiveKey = null;
            generation.incrementAndGet();
            ephemeral = null;
            deviceNonce = "";
            sessionId = "";
            updatePong();
            Request request = new Request.Builder().url(relayUrl)
                .header("User-Agent", "relaydeck-android")
                .build();
            socket = client.newWebSocket(request, new WebSocketListener() {
                @Override public void onOpen(WebSocket webSocket, Response response) {
                    try {
                        JSONObject register = new JSONObject()
                            .put("type", "register-device")
                            .put("version", 1)
                            .put("machineId", machineId);
                        if (!credential.isEmpty()) register.put("credential", credential);
                        else register.put("ticket", ticket);
                        webSocket.send(register.toString());
                    } catch (Exception error) {
                        fail(webSocket, error);
                    }
                }

                @Override public void onMessage(WebSocket webSocket, String text) {
                    receive(webSocket, text);
                }

                @Override public void onFailure(WebSocket webSocket, Throwable error, Response response) {
                    fail(webSocket, error);
                }

                @Override public void onClosed(WebSocket webSocket, int code, String reason) {
                    if (webSocket == socket) {
                        socket = null;
                        state = closed ? "closed" : "offline";
                        lastError = reason == null ? "" : reason;
                    }
                    synchronized (connectSignal) { connectSignal.notifyAll(); }
                }
            });
            long until = System.currentTimeMillis() + Math.max(5000, timeoutMs);
            while (!connected() && socket != null && System.currentTimeMillis() < until)
                connectSignal.wait(Math.max(1, until - System.currentTimeMillis()));
        }
        if (!connected()) throw new Exception(lastError.isEmpty() ? "Relay 连接超时，请检查电脑和 Relay 状态" : "Relay 连接失败：" + lastError);
    }

    private void receive(WebSocket webSocket, String text) {
        JSONObject message = RelayCrypto.parse(text);
        if (message == null || webSocket != socket) return;
        String type = message.optString("type");
        if ("device-ready".equals(type)) {
            try {
                String issued = message.optString("credential", "");
                if (!issued.isEmpty()) {
                    if (!issued.matches("[A-Za-z0-9_-]{24,80}")) throw new Exception("Relay 返回的设备凭据无效");
                    credential = issued;
                    pairedCredential = issued;
                }
                String hello = message.optJSONObject("machineHello") == null ? "" : message.getJSONObject("machineHello").toString();
                if (hello.isEmpty()) throw new Exception("Relay 未返回电脑握手信息");
                JSONObject machineHello = new JSONObject(hello);
                String signingKey = machineHello.optString("machinePublicKey", "");
                String runtimeId = machineHello.optString("runtimeId", "");
                String ephemeralKey = machineHello.optString("ephemeralPublicKey", "");
                String nonce = machineHello.optString("nonce", "");
                String signature = machineHello.optString("signature", "");
                if (!signingKey.equals(machinePublicKey)) throw new Exception("Relay 返回的电脑公钥与二维码不匹配");
                if (!machineFingerprint.equalsIgnoreCase(machineHello.optString("machineFingerprint", machineFingerprint)))
                    throw new Exception("Relay 返回的电脑指纹与二维码不匹配");
                String signed = RelayCrypto.handshakeMessage(machineId, runtimeId, signingKey, ephemeralKey, nonce);
                if (!RelayCrypto.verify(signingKey, signed, signature)) throw new Exception("电脑 Relay 握手签名无效");
                ephemeral = RelayCrypto.ephemeral();
                deviceNonce = randomNonce();
                sessionId = UUID.randomUUID().toString().replace("-", "");
                webSocket.send(new JSONObject()
                    .put("type", "device-hello")
                    .put("sessionId", sessionId)
                    .put("ephemeralPublicKey", RelayCrypto.publicKey(ephemeral))
                    .put("nonce", deviceNonce)
                    .toString());
            } catch (Exception error) {
                fail(webSocket, error);
            }
            return;
        }
        if ("device-hello".equals(type)) {
            try {
                if (!sessionId.equals(message.optString("sessionId", ""))) throw new Exception("Relay 握手会话不匹配");
                if (ephemeral == null) throw new Exception("Relay 设备握手尚未初始化");
                byte[][] keys = RelayCrypto.sessionKeys(ephemeral, message.getString("ephemeralPublicKey"),
                    machineId, message.getString("nonce"), deviceNonce);
                sendKey = keys[0];
                receiveKey = keys[1];
                state = "online";
                lastError = "";
                ticket = "";
                if (!heartbeatStarted) {
                    heartbeatStarted = true;
                    closed = false;
                    heartbeat.execute(() -> {
                        while (!closed) {
                            try {
                                Thread.sleep(25000);
                                WebSocket active = socket;
                                if (active != null && connected()) active.send("{\"type\":\"device-ping\"}");
                                if (System.currentTimeMillis() - lastPongAt > 90000) fail(active, new Exception("Relay 心跳超时"));
                            } catch (InterruptedException interrupted) { return; }
                            catch (Exception ignored) { }
                        }
                    });
                }
                synchronized (connectSignal) { connectSignal.notifyAll(); }
            } catch (Exception error) {
                fail(webSocket, error);
            }
            return;
        }
        if ("ping".equals(type) || "alive".equals(type)) {
            updatePong();
            if (connected()) webSocket.send("{\"type\":\"device-ping\"}");
            return;
        }
        if ("error".equals(type)) {
            String code = message.optString("code", "Relay 拒绝连接");
            String textValue;
            switch (code) {
                case "ticket-expired": textValue = "Relay 配对票据已过期，请在电脑端重新生成"; break;
                case "credential-invalid": textValue = "Relay 长期设备凭据已失效，请重新配对"; break;
                case "machine-offline": textValue = "电脑当前未连接 Relay"; break;
                default: textValue = "Relay：" + code;
            }
            fail(webSocket, new Exception(textValue));
            return;
        }
        if ("stream-open".equals(type) || "stream-ready".equals(type)) return;
        Stream stream = streams.get(message.optString("streamId"));
        if (stream != null && ("stream-data".equals(type) || "stream-end".equals(type) || "stream-close".equals(type)))
            stream.event(message);
    }

    private void updatePong() { lastPongAt = System.currentTimeMillis(); }

    private void fail(WebSocket webSocket, Throwable error) {
        if (webSocket != null && webSocket != socket) return;
        stringError(error);
        state = "error";
        if (webSocket != null) try { webSocket.close(1000, "failed"); } catch (Exception ignored) { }
        if (webSocket == socket) socket = null;
        for (Stream stream : streams.values()) stream.fail(new Exception("Relay 连接已断开"));
        streams.clear();
        synchronized (connectSignal) { connectSignal.notifyAll(); }
    }

    private void stringError(Throwable error) {
        String value = error == null ? null : error.getMessage();
        lastError = value == null || value.isEmpty() ? "Relay 连接失败" : value;
    }

    private void closeSocket() {
        WebSocket active = socket;
        socket = null;
        if (active != null) try { active.close(1000, "reconnect"); } catch (Exception ignored) { }
    }

    JSONObject call(String method, String path, JSONObject body, String operationId, int connectTimeout, int readTimeout,
                    java.util.Set<String> activeStreams) throws Exception {
        if (!connected()) connect(connectTimeout);
        String id = randomId();
        boolean fileRequest = path.startsWith("/v1/file?");
        Stream stream = new Stream(id, readTimeout, fileRequest ? MAX_FILE_ENVELOPE_BYTES : MAX_JSON_BYTES);
        streams.put(id, stream);
        activeStreams.add(id);
        try {
            JSONObject headers = new JSONObject();
            headers.put("authorization", "Bearer " + bearerToken);
            if (operationId != null) headers.put("idempotency-key", operationId);
            JSONObject request = new JSONObject()
                .put("method", method)
                .put("path", path)
                .put("headers", headers);
            if (body != null) request.put("body", body);
            byte[] frame = RelayCrypto.seal(sendKey, request.toString().getBytes(StandardCharsets.UTF_8), 0);
            WebSocket active = socket;
            if (active == null) throw new Exception("Relay 未连接");
            active.send(new JSONObject().put("type", "stream-open").put("streamId", id).toString());
            for (byte[] chunk : chunks(frame)) {
                active.send(new JSONObject()
                    .put("type", "stream-data")
                    .put("streamId", id)
                    .put("seq", 0)
                    .put("bytes", chunk.length)
                    .put("data", Base64.getUrlEncoder().withoutPadding().encodeToString(chunk))
                    .toString());
            }
            active.send(new JSONObject().put("type", "stream-end").put("streamId", id).put("seq", 0).toString());
            JSONObject response = stream.await();
            int status = response.optInt("status", 502);
            byte[] bytes = response.opt("bodyBytes") instanceof byte[]
                ? (byte[]) response.opt("bodyBytes") : new byte[0];
            String contentType = response.optJSONObject("headers") == null
                ? "" : response.getJSONObject("headers").optString("content-type", "");
            if (contentType.toLowerCase(java.util.Locale.ROOT).startsWith("application/octet-stream")
                || !startsWithJson(bytes)) {
                if (status != 200) throw new RelayException(status, binaryError(status, bytes));
                return new JSONObject()
                    .put("body", Base64.getUrlEncoder().withoutPadding().encodeToString(bytes))
                    .put("contentType", "application/octet-stream");
            }
            JSONObject result;
            try { result = new JSONObject(new String(bytes, StandardCharsets.UTF_8)); }
            catch (Exception malformed) { throw new Exception("Relay 返回了无法解析的数据"); }
            if (status != 200) throw new RelayException(status, result.optString("error", "Relay 请求失败（" + status + "）"));
            return result;
        } finally {
            streams.remove(id);
            activeStreams.remove(id);
        }
    }

    byte[] file(String threadId, String id, java.util.Set<String> activeStreams) throws Exception {
        String path = "/v1/file?threadId=" + URLEncoder.encode(threadId, "UTF-8")
            + "&id=" + URLEncoder.encode(id, "UTF-8");
        JSONObject value = call("GET", path, null, null, 8000, 60000, activeStreams);
        byte[] bytes = Base64.getUrlDecoder().decode(value.optString("body", ""));
        if (bytes.length > MAX_FILE_BYTES) throw new Exception("文件超过 32 MB");
        return bytes;
    }

    void release(long ownedGeneration) {
        if (ownedGeneration < generation.get()) return;
        closed = true;
        state = "closed";
        for (Stream stream : streams.values()) stream.fail(new Exception("连接已取消"));
        streams.clear();
        closeSocket();
    }

    java.util.Set<String> openStreams() {
        return new java.util.HashSet<>(streams.keySet());
    }

    void cancelStream(String id) {
        Stream stream = streams.remove(id);
        if (stream != null) stream.fail(new Exception("连接已取消"));
    }

    boolean hasCredential() { return credential != null && !credential.isEmpty(); }
    boolean hasTicket() { return ticket != null && !ticket.isEmpty(); }
    void restoreTicket(String value) { if (value != null && value.matches("[A-Za-z0-9_-]{24,80}")) ticket = value; }
    void upgrade(String newCredential) { pairedCredential = newCredential; credential = newCredential; }

    void reconnectForSession() {
        if (credential.isEmpty() || !hasTicket()) return;
        closeSocket();
    }

    private static boolean startsWithJson(byte[] bytes) {
        for (byte value : bytes) {
            if (value == ' ' || value == '\n' || value == '\r' || value == '\t') continue;
            return value == '{' || value == '[';
        }
        return false;
    }

    private static String binaryError(int status, byte[] bytes) {
        if (startsWithJson(bytes)) try {
            return new JSONObject(new String(bytes, StandardCharsets.UTF_8))
                .optString("error", "Relay 请求失败（" + status + "）");
        } catch (Exception ignored) { }
        return "Relay 请求失败（" + status + "）";
    }

    private static java.util.List<byte[]> chunks(byte[] bytes) {
        java.util.List<byte[]> result = new java.util.ArrayList<>();
        for (int offset = 0; offset < bytes.length; offset += 256 * 1024)
            result.add(Arrays.copyOfRange(bytes, offset, Math.min(bytes.length, offset + 256 * 1024)));
        if (result.isEmpty()) result.add(new byte[0]);
        return result;
    }

    private static String randomId() {
        byte[] value = new byte[18];
        new java.security.SecureRandom().nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private static String randomNonce() {
        byte[] value = new byte[24];
        new java.security.SecureRandom().nextBytes(value);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
    }

    private final class Stream {
        final String id;
        final Object signal = new Object();
        final long timeoutMs;
        final int maxBytes;
        JSONObject response;
        byte[] body;
        Exception failure;
        long lastAt;

        Stream(String id, long timeoutMs, int maxBytes) {
            this.id = id;
            this.timeoutMs = Math.max(3000, timeoutMs);
            this.maxBytes = maxBytes;
            this.lastAt = System.currentTimeMillis();
        }

        JSONObject await() throws Exception {
            long until = System.currentTimeMillis() + timeoutMs;
            synchronized (signal) {
                while (response == null && failure == null && System.currentTimeMillis() < until)
                    signal.wait(Math.max(1, until - System.currentTimeMillis()));
            }
            if (failure != null) throw failure;
            if (response == null) throw new Exception("Relay 请求超时");
            return response;
        }

        void event(JSONObject message) {
            String type = message.optString("type");
            if ("stream-close".equals(type)) {
                fail(new Exception(message.optString("code", "Relay 数据流已关闭")));
                return;
            }
            if ("stream-data".equals(type)) {
                try {
                    byte[] part = Base64.getUrlDecoder().decode(message.optString("data", ""));
                    if (part.length > maxBytes || (body == null ? part.length : body.length + part.length) > maxBytes)
                        throw new Exception("Relay 响应过大");
                    body = body == null ? part : concat(body, part);
                    lastAt = System.currentTimeMillis();
                } catch (Exception error) { fail(error); }
                return;
            }
            if ("stream-end".equals(type)) {
                try {
                    if (body == null) throw new Exception("Relay 响应为空");
                    JSONObject envelope = new JSONObject(new String(
                        RelayCrypto.open(receiveKey, body, 0), StandardCharsets.UTF_8));
                    byte[] decoded = Base64.getUrlDecoder().decode(envelope.optString("body", ""));
                    if (decoded.length > MAX_FILE_BYTES) throw new Exception("Relay 响应过大");
                    response = envelope.put("bodyBytes", decoded);
                    synchronized (signal) { signal.notifyAll(); }
                } catch (Exception error) { fail(error); }
            }
        }

        void fail(Exception error) {
            failure = error;
            synchronized (signal) { signal.notifyAll(); }
        }
    }

    private static byte[] concat(byte[] left, byte[] right) {
        byte[] result = Arrays.copyOf(left, left.length + right.length);
        System.arraycopy(right, 0, result, left.length, right.length);
        return result;
    }
}
