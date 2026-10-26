package dev.relaydeck.mobile;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import org.json.JSONObject;

/** Home-screen quota widget; cached values stay available after the app process is reclaimed. */
public final class QuotaWidgetProvider extends AppWidgetProvider {
    private static final int OPEN_REQUEST=3101,REFRESH_REQUEST=3102;

    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){
        update(context,manager,ids);
    }

    @Override public void onAppWidgetOptionsChanged(Context context,AppWidgetManager manager,int id,android.os.Bundle options){
        update(context,manager,new int[]{id});
    }

    @Override public void onReceive(Context context,Intent intent){
        if(SessionService.USAGE_UPDATE.equals(intent.getAction())){
            updateAll(context);
            return;
        }
        super.onReceive(context,intent);
    }

    static void updateAll(Context context){
        AppWidgetManager manager=AppWidgetManager.getInstance(context);
        int[] ids=manager.getAppWidgetIds(new ComponentName(context,QuotaWidgetProvider.class));
        if(ids.length>0)update(context,manager,ids);
    }

    private static void update(Context context,AppWidgetManager manager,int[] ids){
        Snapshot snapshot=snapshot(context);
        for(int id:ids)manager.updateAppWidget(id,views(context,snapshot));
    }

    private static RemoteViews views(Context context,Snapshot snapshot){
        RemoteViews views=new RemoteViews(context.getPackageName(),R.layout.quota_widget);
        JSONObject primary=snapshot.value==null?null:snapshot.value.optJSONObject("primary");
        JSONObject secondary=snapshot.value==null?null:snapshot.value.optJSONObject("secondary");
        String status=UsagePresentation.widgetStatus(snapshot.value,snapshot.paired,snapshot.live,snapshot.online,System.currentTimeMillis());
        String primaryPeriod=UsagePresentation.period(primary,"短周期");
        String secondaryPeriod=UsagePresentation.period(secondary,"长周期");
        String primaryPercent=snapshot.value==null?"--":UsagePresentation.percent(primary);
        String secondaryPercent=snapshot.value==null?"--":UsagePresentation.percent(secondary);

        views.setTextViewText(R.id.quota_primary_period,primaryPeriod);
        views.setTextViewText(R.id.quota_secondary_period,secondaryPeriod);
        views.setTextViewText(R.id.quota_primary_percent,primaryPercent);
        views.setTextViewText(R.id.quota_secondary_percent,secondaryPercent);
        views.setTextViewText(R.id.quota_status,status);
        views.setTextViewText(R.id.quota_refresh,snapshot.paired?"刷新":"打开");

        PendingIntent open=openApp(context);
        views.setOnClickPendingIntent(R.id.quota_widget_root,open);
        views.setOnClickPendingIntent(R.id.quota_refresh,snapshot.paired?refreshUsage(context):open);
        views.setContentDescription(R.id.quota_widget_root,
            "剩余额度，"+primaryPeriod+" "+primaryPercent+"，"+secondaryPeriod+" "+secondaryPercent+"，"+status);
        return views;
    }

    private static PendingIntent openApp(Context context){
        return PendingIntent.getActivity(context,OPEN_REQUEST,new Intent(context,QuotaBubbleActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent refreshUsage(Context context){
        Intent intent=new Intent(context,SessionService.class).setAction(SessionService.ACTION_REFRESH_USAGE);
        return PendingIntent.getForegroundService(context,REFRESH_REQUEST,intent,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static Snapshot snapshot(Context context){
        try{
            JSONObject connection=new SecureSession(context).load();
            if(connection==null)return new Snapshot(false,null,false,false);
            String fingerprint=connection.optString("fingerprint");
            JSONObject cached=null;
            try{cached=new UsageCache(context,fingerprint).load();}catch(Exception ignored){}
            boolean live=SessionService.running&&SessionService.usageReceivedAt>0
                &&fingerprint.equals(SessionService.usageComputer)&&SessionService.usage!=null;
            JSONObject value=live?SessionService.usage:cached;
            boolean online=SessionService.running&&SessionService.latest!=null
                &&fingerprint.equals(SessionService.latest.optString("computer"))
                &&SessionService.latest.optBoolean("online");
            return new Snapshot(true,value,live,online);
        }catch(Exception ignored){
            return new Snapshot(false,null,false,false);
        }
    }

    private static final class Snapshot{
        final boolean paired,live,online;
        final JSONObject value;
        Snapshot(boolean paired,JSONObject value,boolean live,boolean online){
            this.paired=paired;this.value=value;this.live=live;this.online=online;
        }
    }
}
