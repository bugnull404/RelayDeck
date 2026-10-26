package dev.relaydeck.mobile;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;

/** Per-computer encrypted, atomic cache; approvals are display-only until online validation. */
final class HistoryCache {
    static final int MISSING=0,READY=1,CORRUPT=2;
    static final class CacheException extends Exception {final int kind;CacheException(int kind,String message,Throwable cause){super(message,cause);this.kind=kind;}}
    private static final Object LOCK = new Object();
    private final AtomicFile file;
    HistoryCache(Context context, String fingerprint) throws Exception {
        File directory = new File(context.getFilesDir(), "history");
        if (!directory.exists() && !directory.mkdirs()) throw new Exception("无法创建本地历史目录");
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(fingerprint.getBytes(StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder(); for (byte value : digest) name.append(String.format("%02x", value));
        file = new AtomicFile(new File(directory, name + ".bin"));
    }
    JSONObject load() throws Exception {
        synchronized (LOCK) {
            try { return new JSONObject(new String(SecureSession.decrypt(file.readFully()), StandardCharsets.UTF_8)); }
            catch (java.io.FileNotFoundException missing) { throw new CacheException(MISSING,"没有本地历史缓存",missing); }
            catch (Exception damaged) { throw new CacheException(CORRUPT,"本地历史缓存损坏，已保留原文件。请重新同步后清除缓存",damaged); }
        }
    }
    boolean exists(){return file.getBaseFile().isFile();}
    static JSONObject bounded(JSONObject value) throws Exception {
        JSONObject bounded = MobileState.retain(value,value == null ? null : value.optJSONArray("catalog"));
        JSONArray catalog = value == null ? null : value.optJSONArray("catalog");
        if(catalog != null) bounded.put("catalog",catalog);
        return bounded;
    }
    void save(JSONObject value) throws Exception {
        synchronized (LOCK) {
            byte[] encrypted = SecureSession.encrypt(bounded(value).toString().getBytes(StandardCharsets.UTF_8));
            FileOutputStream output = null;
            try { output = file.startWrite(); output.write(encrypted); file.finishWrite(output); }
            catch (Exception error) { if (output != null) file.failWrite(output); throw error; }
        }
    }
    void clear() { synchronized (LOCK) { file.delete(); } }
}
