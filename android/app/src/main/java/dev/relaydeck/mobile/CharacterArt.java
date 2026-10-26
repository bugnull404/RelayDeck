package dev.relaydeck.mobile;

import android.content.ContentResolver;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

/** Stores one locally imported character image in app-private storage. */
final class CharacterArt {
    private static final String DIRECTORY="character";
    private static final String FILE_NAME="character.png";
    private static final long MAX_SOURCE_BYTES=16L*1024*1024;
    private static final long MAX_SOURCE_PIXELS=32_000_000L;
    private static final int NORMALIZED_EDGE=1536;
    private static final int MAX_LOAD_EDGE=2048;

    private CharacterArt() {}

    static boolean exists(Context context) {
        File file=target(context);
        return file.isFile()&&file.length()>0;
    }

    static Bitmap load(Context context,int maxEdge) {
        File file=target(context);
        if(!file.isFile()||file.length()==0)return null;
        int edge=Math.max(64,Math.min(maxEdge,MAX_LOAD_EDGE));
        BitmapFactory.Options bounds=new BitmapFactory.Options();
        bounds.inJustDecodeBounds=true;
        BitmapFactory.decodeFile(file.getAbsolutePath(),bounds);
        if(bounds.outWidth<=0||bounds.outHeight<=0)return null;

        BitmapFactory.Options options=new BitmapFactory.Options();
        options.inPreferredConfig=Bitmap.Config.ARGB_8888;
        options.inSampleSize=sampleSize(bounds.outWidth,bounds.outHeight,edge);
        Bitmap bitmap=BitmapFactory.decodeFile(file.getAbsolutePath(),options);
        if(bitmap==null)return null;
        if(Math.max(bitmap.getWidth(),bitmap.getHeight())<=edge)return bitmap;

        int width=Math.max(1,Math.round(bitmap.getWidth()*(float)edge/Math.max(bitmap.getWidth(),bitmap.getHeight())));
        int height=Math.max(1,Math.round(bitmap.getHeight()*(float)edge/Math.max(bitmap.getWidth(),bitmap.getHeight())));
        Bitmap scaled=Bitmap.createScaledBitmap(bitmap,width,height,true);
        if(scaled!=bitmap)bitmap.recycle();
        return scaled;
    }

    static void importFrom(Context context,Uri source) throws IOException,IllegalArgumentException {
        if(source==null)throw new IllegalArgumentException("没有选择图片");
        File directory=directory(context);
        if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法创建角色素材目录");

        File raw=File.createTempFile("source-",".tmp",directory);
        File normalized=null;
        try {
            copyLimited(context.getContentResolver(),source,raw);
            validateHeader(raw);

            BitmapFactory.Options bounds=new BitmapFactory.Options();
            bounds.inJustDecodeBounds=true;
            BitmapFactory.decodeFile(raw.getAbsolutePath(),bounds);
            if(bounds.outWidth<=0||bounds.outHeight<=0)throw new IllegalArgumentException("所选文件不是可读取的图片");
            long pixels=(long)bounds.outWidth*bounds.outHeight;
            if(pixels>MAX_SOURCE_PIXELS)throw new IllegalArgumentException("图片尺寸过大，请先缩小到 3200 万像素以内");

            BitmapFactory.Options options=new BitmapFactory.Options();
            options.inPreferredConfig=Bitmap.Config.ARGB_8888;
            options.inSampleSize=sampleSize(bounds.outWidth,bounds.outHeight,NORMALIZED_EDGE);
            Bitmap decoded=BitmapFactory.decodeFile(raw.getAbsolutePath(),options);
            if(decoded==null)throw new IllegalArgumentException("图片解码失败，请换一张 PNG 或 WebP");

            Bitmap output=decoded;
            int max=Math.max(decoded.getWidth(),decoded.getHeight());
            if(max>NORMALIZED_EDGE){
                int width=Math.max(1,Math.round(decoded.getWidth()*(float)NORMALIZED_EDGE/max));
                int height=Math.max(1,Math.round(decoded.getHeight()*(float)NORMALIZED_EDGE/max));
                output=Bitmap.createScaledBitmap(decoded,width,height,true);
            }

            normalized=File.createTempFile("character-",".png",directory);
            try(FileOutputStream stream=new FileOutputStream(normalized)){
                if(!output.compress(Bitmap.CompressFormat.PNG,100,stream))throw new IOException("无法保存角色素材");
                stream.flush();
                stream.getFD().sync();
            }finally{
                if(output!=decoded)output.recycle();
                decoded.recycle();
            }
            replace(normalized,target(context));
            normalized=null;
        }finally{
            delete(raw);
            delete(normalized);
        }
    }

    static void clear(Context context) {
        File directory=directory(context);
        delete(target(context));
        File[] files=directory.listFiles();
        if(files!=null)for(File file:files)if(file.getName().startsWith("source-")||file.getName().startsWith("character-"))delete(file);
        delete(new File(directory,"character.old"));
    }

    private static void copyLimited(ContentResolver resolver,Uri source,File destination) throws IOException {
        long total=0;
        byte[] buffer=new byte[64*1024];
        try(InputStream input=resolver.openInputStream(source);
            FileOutputStream output=new FileOutputStream(destination)){
            if(input==null)throw new IOException("无法读取所选图片");
            int read;
            while((read=input.read(buffer))!=-1){
                total+=read;
                if(total>MAX_SOURCE_BYTES)throw new IllegalArgumentException("图片文件过大，请选择 16 MB 以内的素材");
                output.write(buffer,0,read);
            }
            if(total==0)throw new IllegalArgumentException("所选文件为空");
            output.flush();
            output.getFD().sync();
        }
    }

    private static void validateHeader(File file) throws IOException {
        byte[] header=new byte[12];
        int read;
        try(FileInputStream input=new FileInputStream(file)){
            read=input.read(header);
        }
        boolean png=read>=8&&header[0]==(byte)0x89&&header[1]==0x50&&header[2]==0x4e&&header[3]==0x47;
        boolean webp=read>=12&&header[0]=='R'&&header[1]=='I'&&header[2]=='F'&&header[3]=='F'
            &&header[8]=='W'&&header[9]=='E'&&header[10]=='B'&&header[11]=='P';
        boolean jpeg=read>=3&&header[0]==(byte)0xff&&header[1]==(byte)0xd8&&header[2]==(byte)0xff;
        if(!png&&!webp&&!jpeg)throw new IllegalArgumentException("请选择 PNG、WebP 或 JPEG 图片");
    }

    private static int sampleSize(int width,int height,int maxEdge) {
        int sample=1;
        while(Math.max(width/sample,height/sample)>maxEdge)sample*=2;
        return sample;
    }

    private static void replace(File source,File destination) throws IOException {
        File backup=new File(destination.getParentFile(),"character.old");
        delete(backup);
        if(destination.exists()&&!destination.renameTo(backup))throw new IOException("无法替换已有角色素材");
        if(source.renameTo(destination)){delete(backup);return;}
        if(backup.exists())backup.renameTo(destination);
        throw new IOException("无法保存角色素材");
    }

    private static File directory(Context context) {
        return new File(context.getFilesDir(),DIRECTORY);
    }

    private static File target(Context context) {
        return new File(directory(context),FILE_NAME);
    }

    private static void delete(File file) {
        if(file!=null&&file.exists())file.delete();
    }
}
