package dev.relaydeck.mobile;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Per-computer encrypted quota cache containing only fields rendered by the widget. */
final class UsageCache {
    private static final Object LOCK=new Object();
    private final AtomicFile file;
    private final String fingerprint;

    UsageCache(Context context,String fingerprint)throws Exception{
        this.fingerprint=fingerprint.replace(":","").replaceAll("\\s","").toLowerCase(java.util.Locale.ROOT);
        File directory=new File(context.getFilesDir(),"usage");
        if(!directory.exists()&&!directory.mkdirs())throw new Exception("无法创建额度缓存目录");
        file=new AtomicFile(cacheFile(directory,this.fingerprint));
    }

    JSONObject load()throws Exception{
        synchronized(LOCK){
            JSONObject stored=new JSONObject(new String(SecureSession.decrypt(file.readFully()),StandardCharsets.UTF_8));
            if(!fingerprint.equals(stored.optString("computer")))throw new Exception("额度缓存与当前电脑不匹配");
            return UsagePresentation.cacheValue(stored);
        }
    }

    void save(JSONObject value)throws Exception{
        JSONObject bounded=UsagePresentation.cacheValue(value);
        if(bounded==null)return;
        bounded.put("computer",fingerprint);
        synchronized(LOCK){
            byte[] encrypted=SecureSession.encrypt(bounded.toString().getBytes(StandardCharsets.UTF_8));
            FileOutputStream output=null;
            try{
                output=file.startWrite();
                output.write(encrypted);
                file.finishWrite(output);
            }catch(Exception error){
                if(output!=null)file.failWrite(output);
                throw error;
            }
        }
    }

    static void clear(Context context,String fingerprint){
        try{
            File directory=new File(context.getFilesDir(),"usage");
            String normalized=fingerprint.replace(":","").replaceAll("\\s","").toLowerCase(java.util.Locale.ROOT);
            synchronized(LOCK){new AtomicFile(cacheFile(directory,normalized)).delete();}
        }catch(Exception ignored){}
    }

    static void clearAll(Context context){
        File[] files=new File(context.getFilesDir(),"usage").listFiles();
        if(files==null)return;
        synchronized(LOCK){
            for(File file:files)if(file.isFile())file.delete();
        }
    }

    private static File cacheFile(File directory,String fingerprint)throws Exception{
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(fingerprint.getBytes(StandardCharsets.UTF_8));
        StringBuilder name=new StringBuilder();
        for(byte value:digest)name.append(String.format("%02x",value));
        return new File(directory,name+".bin");
    }
}
