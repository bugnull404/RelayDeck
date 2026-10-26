package dev.relaydeck.mobile;

import org.json.JSONObject;

final class UsagePresentation {
    static float remaining(JSONObject window) {
        Object value=window==null?null:window.opt("remainingPercent");
        if(!(value instanceof Number))return -1;
        double number=((Number)value).doubleValue();
        return Double.isFinite(number)&&number>=0&&number<=100?(float)number:-1;
    }
    static String period(JSONObject window,String fallback) {
        long minutes=window==null?0:window.optLong("windowDurationMins");
        if(minutes<=0)return fallback;
        if(minutes%1440==0)return(minutes/1440)+" 天";
        if(minutes%60==0)return(minutes/60)+" 小时";
        return minutes+" 分钟";
    }
    static String percent(JSONObject window) {
        float value=remaining(window);return value<0?"暂不可用":Math.round(value)+"% 剩余";
    }
    static int progress(JSONObject window) {
        float value=remaining(window);
        return value<0?0:Math.round(value);
    }
    static JSONObject cacheValue(JSONObject value) {
        if(value==null)return null;
        JSONObject bounded=new JSONObject();
        try{
            bounded.put("available",value.optBoolean("available"));
            JSONObject primary=boundedWindow(value.optJSONObject("primary"));
            JSONObject secondary=boundedWindow(value.optJSONObject("secondary"));
            if(primary!=null)bounded.put("primary",primary);
            if(secondary!=null)bounded.put("secondary",secondary);
            long updatedAt=value.optLong("updatedAt");
            if(updatedAt>0)bounded.put("updatedAt",updatedAt);
            bounded.put("stale",value.optBoolean("stale"));
        }catch(Exception ignored){return null;}
        return bounded;
    }
    private static JSONObject boundedWindow(JSONObject window) {
        if(window==null)return null;
        JSONObject bounded=new JSONObject();
        try{
            Object raw=window.opt("remainingPercent");
            if(raw instanceof Number){
                double number=((Number)raw).doubleValue();
                if(Double.isFinite(number)&&number>=0&&number<=100)bounded.put("remainingPercent",Math.round(number*10)/10.0);
            }
            long minutes=window.optLong("windowDurationMins");
            if(minutes>0)bounded.put("windowDurationMins",minutes);
            long resetsAt=window.optLong("resetsAt");
            if(resetsAt>0)bounded.put("resetsAt",resetsAt);
        }catch(Exception ignored){return null;}
        return bounded.length()==0?null:bounded;
    }
    static String widgetStatus(JSONObject value,boolean paired,boolean live,boolean online,long now) {
        if(!paired)return "未配对";
        if(value==null||!value.optBoolean("available"))return "暂无数据";
        long updatedAt=value.optLong("updatedAt");
        String time=updatedAt>0?new java.text.SimpleDateFormat("HH:mm",java.util.Locale.CHINA).format(new java.util.Date(updatedAt)):"时间未知";
        if(!online)return "离线 · "+time;
        if(value.optBoolean("stale")||!live)return "缓存 · "+time;
        return "实时 · "+time;
    }
    static String connection(JSONObject state,JSONObject thread,String message) {
        if(state==null)return "connecting";
        if(!state.optBoolean("online"))return message!=null&&(message.contains("中断")||message.contains("失败")||message.contains("无法"))?"error":"offline";
        if(thread==null||!thread.optBoolean("ready"))return "waiting";
        if((thread.optJSONArray("approvals")!=null&&thread.optJSONArray("approvals").length()>0)||(thread.optJSONArray("questions")!=null&&thread.optJSONArray("questions").length()>0))return "waiting";
        return MobileState.activeTurnId(thread).isEmpty()?"connected":"busy";
    }
}
