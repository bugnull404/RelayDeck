package dev.relaydeck.mobile;

import org.json.JSONObject;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.Set;
import java.util.Map;
import java.util.Collections;
import java.util.WeakHashMap;
import java.util.concurrent.ConcurrentHashMap;
import okhttp3.OkHttpClient;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

final class RemoteApi {
    static final int MAX_JSON_BYTES=7*1024*1024;
    private static final Map<RemoteApi,RelayTransport> RELAYS = Collections.synchronizedMap(new WeakHashMap<>());
    private static final Map<RelayTransport,Integer> RELAY_USES = new WeakHashMap<>();
    private static volatile OkHttpClient http;
    static final class ApiException extends Exception {final int status;ApiException(int status,String message){super(message);this.status=status;}}
    final String address;
    final String fingerprint;
    volatile String token;
    private final SSLContext ssl;
    private final javax.net.ssl.SSLSocketFactory socketFactory;
    private final javax.net.ssl.HostnameVerifier verifier;
    private final Set<HttpsURLConnection> connections = ConcurrentHashMap.newKeySet();
    private final Set<String> activeStreams = ConcurrentHashMap.newKeySet();
    private volatile RelayTransport relayTransport;
    private volatile long relayGeneration;
    private boolean released;
    RemoteApi(String address, String fingerprint, String token) throws Exception {
        this(address,fingerprint,token,null);
    }
    RemoteApi(String address, String fingerprint, String token, RelayTransport relay) throws Exception {
        URI uri = new URI(address.trim());
        if (relay == null && (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || !(uri.getPath().isEmpty() || uri.getPath().equals("/")))) throw new Exception("请输入 https://电脑IP:端口");
        if (relay != null && !"wss".equalsIgnoreCase(uri.getScheme())) throw new Exception("Relay 地址必须使用 wss://");
        this.address = address.trim().replaceAll("/+$", "");
        this.fingerprint = fingerprint.replace(":", "").replaceAll("\\s", "").toLowerCase(java.util.Locale.ROOT);
        if (!this.fingerprint.matches("[a-f0-9]{64}")) throw new Exception("证书指纹应为 64 位十六进制字符");
        this.token = token;
        if (relay != null) {
            synchronized(RELAYS){retain(relay);RELAYS.put(this,relay);relayTransport=relay;relayGeneration=relay.generation();}
        }
        ssl = SSLContext.getInstance("TLS");
        ssl.init(null, new TrustManager[] { new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkClientTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException { throw new java.security.cert.CertificateException("仅支持服务端证书"); }
            public void checkServerTrusted(X509Certificate[] chain, String auth) throws java.security.cert.CertificateException {
                try {
                    if (chain == null || chain.length == 0) throw new Exception();
                    chain[0].checkValidity();
                    if (!matches(chain[0])) throw new Exception();
                } catch (Exception error) { throw new java.security.cert.CertificateException("电脑证书与配对指纹不符或已过期"); }
            }
        } }, new java.security.SecureRandom());
        socketFactory=ssl.getSocketFactory();
        verifier=(host,session)->{try{return matches(session.getPeerCertificates()[0]);}catch(Exception e){return false;}};
    }
    private RemoteApi(RemoteApi owner){
        address=owner.address;fingerprint=owner.fingerprint;token=owner.token;ssl=owner.ssl;socketFactory=owner.socketFactory;verifier=owner.verifier;
        synchronized(RELAYS){RelayTransport relay=RELAYS.get(owner);if(relay!=null){retain(relay);RELAYS.put(this,relay);relayTransport=relay;relayGeneration=relay.generation();}}
    }
    // Share TLS sessions and connection-pool identity, with independent cancellation.
    RemoteApi readChannel(){return new RemoteApi(this);}
    private boolean matches(java.security.cert.Certificate cert) throws Exception {
        byte[] expected = new byte[32];
        for (int i = 0; i < 32; i++) expected[i] = (byte) Integer.parseInt(fingerprint.substring(i * 2, i * 2 + 2), 16);
        return MessageDigest.isEqual(expected, MessageDigest.getInstance("SHA-256").digest(cert.getEncoded()));
    }
    JSONObject call(String method, String path, JSONObject body, String operationId) throws Exception {
        return call(method,path,body,operationId,8000,30000);
    }
    JSONObject call(String method, String path, JSONObject body, String operationId,int connectTimeout,int readTimeout) throws Exception {
        RelayTransport relay=RELAYS.get(this);
        if(relay!=null){
            relayGeneration=relay.generation();
            return relay.call(method,path,body,operationId,connectTimeout,readTimeout,activeStreams);
        }
        HttpsURLConnection connection = (HttpsURLConnection) new URL(address + path).openConnection();
        connections.add(connection);
        try {
            connection.setSSLSocketFactory(socketFactory);
            // Identity is the explicitly pinned certificate; IP addresses may change across networks.
            connection.setHostnameVerifier(verifier);
            connection.setConnectTimeout(connectTimeout); connection.setReadTimeout(readTimeout); connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod(method); connection.setRequestProperty("Accept", "application/json");
            if (token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);
            if (operationId != null) connection.setRequestProperty("Idempotency-Key", operationId);
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json"); connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int status = connection.getResponseCode();
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (input == null) throw new Exception("电脑未返回数据（" + status + "）");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (input) {
                byte[] buffer = new byte[8192]; int read;
                while ((read = input.read(buffer)) != -1) { if (bytes.size() + read > MAX_JSON_BYTES) throw new RemoteApi.ApiException(413,"电脑状态超过手机上限，已保留本地记录"); bytes.write(buffer, 0, read); }
            }
            JSONObject result = new JSONObject(bytes.toString("UTF-8"));
            if (status != 200) throw new ApiException(status,result.optString("error", "请求失败（" + status + "）"));
            return result;
        } finally { connections.remove(connection); connection.disconnect(); }
    }
    byte[] file(String threadId,String id) throws Exception {
        RelayTransport relay=RELAYS.get(this);
        if(relay!=null){
            relayGeneration=relay.generation();
            return relay.file(threadId,id,activeStreams);
        }
        String path="/v1/file?threadId="+java.net.URLEncoder.encode(threadId,"UTF-8")+"&id="+java.net.URLEncoder.encode(id,"UTF-8");
        HttpsURLConnection connection=(HttpsURLConnection)new URL(address+path).openConnection();connections.add(connection);
        try{
            connection.setSSLSocketFactory(socketFactory);connection.setHostnameVerifier(verifier);connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(8000);connection.setReadTimeout(60000);connection.setRequestProperty("Authorization","Bearer "+token);
            int status=connection.getResponseCode();
            if(status!=200){try(InputStream input=connection.getErrorStream()){ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(input!=null){byte[] block=new byte[1024];int count;while(bytes.size()<4096&&(count=input.read(block,0,Math.min(block.length,4096-bytes.size())))!=-1)bytes.write(block,0,count);}throw new Exception(new JSONObject(bytes.toString("UTF-8")).optString("error","文件读取失败"));}}
            if(connection.getContentLengthLong()>32*1024*1024)throw new Exception("文件超过 32 MB");
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream input=connection.getInputStream()){byte[] block=new byte[16384];int count;while((count=input.read(block))!=-1){if(bytes.size()+count>32*1024*1024)throw new Exception("文件超过 32 MB");bytes.write(block,0,count);}}return bytes.toByteArray();
        }finally{connections.remove(connection);connection.disconnect();}
    }
    void cancel() {
        RelayTransport relay;
        synchronized(RELAYS){
            if(released)return;
            relay=RELAYS.get(this);
        }
        for(String id:activeStreams)if(relay!=null)relay.cancelStream(id);
        activeStreams.clear();
        for (HttpsURLConnection connection : connections) connection.disconnect();
    }
    void disconnectTransport(){
        RelayTransport relay;
        synchronized(RELAYS){
            if(released)return;
            released=true;
            relay=RELAYS.remove(this);
            if(relay!=null){
                int uses=Math.max(0,RELAY_USES.getOrDefault(relay,0)-1);
                if(uses==0){
                    RELAY_USES.remove(relay);
                    relay.release(Long.MAX_VALUE);
                }else RELAY_USES.put(relay,uses);
            }
        }
        for (HttpsURLConnection connection : connections) connection.disconnect();
    }
    private static void retain(RelayTransport relay){
        RELAY_USES.put(relay,RELAY_USES.getOrDefault(relay,0)+1);
    }
    static OkHttpClient httpClient(){
        if(http==null)synchronized(RemoteApi.class){
            if(http==null)http=new OkHttpClient.Builder()
                .connectTimeout(12,java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(0,java.util.concurrent.TimeUnit.MILLISECONDS)
                .pingInterval(20,java.util.concurrent.TimeUnit.SECONDS)
                .retryOnConnectionFailure(false)
                .build();
        }
        return http;
    }
    static RemoteApi fromConnection(JSONObject connection) throws Exception {
        if(connection==null)throw new Exception("配对信息已清除");
        String address=connection.getString("address"),fingerprint=connection.getString("fingerprint"),token=connection.optString("token","");
        if(!"relay".equals(connection.optString("networkMode")))return new RemoteApi(address,fingerprint,token);
        JSONObject relay=connection.optJSONObject("relay");
        if(relay==null)throw new Exception("Relay 配对信息不完整");
        RelayTransport transport=new RelayTransport(
            relay.getString("url"),relay.getString("machineId"),relay.getString("machinePublicKey"),
            relay.getString("machineFingerprint"),relay.optString("credential",""),relay.optString("ticket",""),token);
        RemoteApi api=new RemoteApi(address,fingerprint,token,transport);
        if(relay.optString("credential","").isEmpty())api.token="";
        return api;
    }
    static boolean isRelay(JSONObject connection){
        return connection!=null&&"relay".equals(connection.optString("networkMode"));
    }
    static String issuedRelayCredential(RemoteApi api){
        RelayTransport relay=RELAYS.get(api);
        return relay!=null&&relay.hasCredential()?relay.issuedCredential():"";
    }
    static boolean relayNeedsTicket(RemoteApi api){
        RelayTransport relay=RELAYS.get(api);
        return relay!=null&&!relay.hasCredential()&&!relay.hasTicket();
    }
    static void restoreRelayTicket(RemoteApi api,String ticket){
        RelayTransport relay=RELAYS.get(api);
        if(relay!=null&&!relay.hasTicket())relay.restoreTicket(ticket);
    }
    static void completeRelayPairing(RemoteApi api,String credential){
        RelayTransport relay=RELAYS.get(api);
        if(relay!=null&&credential!=null&&!credential.isEmpty())relay.upgrade(credential);
    }
    static void updateBearer(RemoteApi api,String token){
        if(api==null)return;
        api.token=token==null?"":token;
        RelayTransport relay=RELAYS.get(api);
        if(relay!=null)relay.bearerToken(api.token);
    }
    static void release(RemoteApi api){
        if(api!=null)api.disconnectTransport();
    }
}
