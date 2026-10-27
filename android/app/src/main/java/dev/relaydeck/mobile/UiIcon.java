package dev.relaydeck.mobile;

import android.graphics.*;
import android.graphics.drawable.Drawable;

/** Small vector controls, independent of emoji fonts and screen density. */
final class UiIcon extends Drawable {
    private final String name;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    UiIcon(String name, int color) { this.name = name; paint.setColor(color); paint.setStrokeWidth(1.8f); paint.setStyle(Paint.Style.STROKE); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND); }
    @Override public void draw(Canvas canvas) {
        canvas.save(); canvas.translate(getBounds().left, getBounds().top); canvas.scale(getBounds().width()/24f, getBounds().height()/24f);
        switch (name) {
            case "voice":line(canvas,5,10,5,14);line(canvas,8.5f,6,8.5f,18);line(canvas,12,9,12,15);line(canvas,15.5f,4,15.5f,20);line(canvas,19,10,19,14);break;
            case "plus":line(canvas,12,5,12,19);line(canvas,5,12,19,12);break;
            case "pin":Path pin=new Path();pin.moveTo(8,3);pin.lineTo(16,3);pin.lineTo(15,11);pin.lineTo(19,15);pin.lineTo(5,15);pin.lineTo(9,11);pin.close();canvas.drawPath(pin,paint);line(canvas,12,15,12,22);break;
            case "folder": Path folder=new Path();folder.moveTo(3,7);folder.lineTo(3,5);folder.quadTo(3,3,5,3);folder.lineTo(10,3);folder.lineTo(12,6);folder.lineTo(20,6);folder.quadTo(22,6,22,8);folder.lineTo(20,20);folder.lineTo(3,20);folder.close();canvas.drawPath(folder,paint);line(canvas,3,9,21,9);break;
            case "phone": canvas.drawRoundRect(6,2,18,22,3,3,paint);line(canvas,10,5,14,5);line(canvas,11,19,13,19);break;
            case "desktop": canvas.drawRoundRect(2,3,22,17,2,2,paint);line(canvas,12,17,12,22);line(canvas,7,22,17,22);break;
            case "download": line(canvas,12,3,12,15);line(canvas,7,10,12,15);line(canvas,12,15,17,10);line(canvas,4,16,4,21);line(canvas,4,21,20,21);line(canvas,20,21,20,16);break;
            case "close": line(canvas,6,6,18,18);line(canvas,18,6,6,18);break;
            case "more": for(int i=0;i<3;i++)canvas.drawCircle(5+i*7,12,1,paint);break;
            case "file": Path file=new Path();file.moveTo(7,3);file.lineTo(14,3);file.lineTo(19,8);file.lineTo(19,21);file.lineTo(5,21);file.lineTo(5,3);file.close();canvas.drawPath(file,paint);line(canvas,14,3,14,8);line(canvas,14,8,19,8);line(canvas,8,13,16,13);line(canvas,8,17,14,17);break;
            case "image": canvas.drawRoundRect(3,3,21,21,3,3,paint);canvas.drawCircle(8,8,1.4f,paint);line(canvas,4,18,10,12);line(canvas,10,12,14,16);line(canvas,14,16,17,13);line(canvas,17,13,21,17);break;
            case "scan": line(canvas,4,9,4,4);line(canvas,4,4,9,4);line(canvas,15,4,20,4);line(canvas,20,4,20,9);line(canvas,20,15,20,20);line(canvas,20,20,15,20);line(canvas,9,20,4,20);line(canvas,4,20,4,15);line(canvas,7,12,17,12);break;
            case "bolt-filled": Path bolt=new Path();bolt.moveTo(13,3);bolt.lineTo(5,13);bolt.lineTo(11,13);bolt.lineTo(9,21);bolt.lineTo(19,10);bolt.lineTo(13,10);bolt.close();paint.setStyle(Paint.Style.FILL);canvas.drawPath(bolt,paint);paint.setStyle(Paint.Style.STROKE);break;
            case "search": canvas.drawCircle(10.5f,10.5f,6.5f,paint);line(canvas,15.5f,15.5f,20,20);break;
            case "bolt": line(canvas,13,3,5,13); line(canvas,5,13,11,13); line(canvas,11,13,9,21); line(canvas,9,21,19,10); line(canvas,19,10,13,10); line(canvas,13,10,13,3); break;
            case "reset": canvas.drawArc(4,4,20,20,-145,310,false,paint); line(canvas,4,4,4,10); line(canvas,4,10,10,10); break;
            case "menu": line(canvas,4,7,20,7); line(canvas,4,12,16,12); line(canvas,4,17,20,17); break;
            case "account": canvas.drawCircle(12,12,9,paint); line(canvas,8.5f,10,15.5f,10); line(canvas,8.5f,14,15.5f,14); break;
            case "edit": Path pencil=new Path();pencil.moveTo(5,19);pencil.lineTo(6,14);pencil.lineTo(15,5);pencil.lineTo(19,9);pencil.lineTo(10,18);pencil.close();canvas.drawPath(pencil,paint);line(canvas,13.5f,6.5f,17.5f,10.5f);line(canvas,6,14,10,18);break;
            case "globe": canvas.drawCircle(12,12,9,paint);line(canvas,3,12,21,12);canvas.drawOval(7,3,17,21,paint);break;
            case "library": line(canvas,5,4,5,20);line(canvas,9,4,9,20);line(canvas,14,5,19,19);line(canvas,18,4,14,20);break;
            case "projects": Path projects=new Path();projects.moveTo(3,8);projects.lineTo(3,6);projects.quadTo(3,4,5,4);projects.lineTo(10,4);projects.lineTo(12,7);projects.lineTo(20,7);projects.quadTo(22,7,22,9);projects.lineTo(21,19);projects.lineTo(3,19);projects.close();canvas.drawPath(projects,paint);line(canvas,3,10,21,10);break;
            case "tasks": canvas.drawCircle(12,12,9,paint);line(canvas,12,7,12,12);line(canvas,12,12,16,14);break;
            case "grid": canvas.drawRoundRect(3,3,10,10,2,2,paint);canvas.drawRoundRect(14,3,21,10,2,2,paint);canvas.drawRoundRect(3,14,10,21,2,2,paint);canvas.drawRoundRect(14,14,21,21,2,2,paint);break;
            case "sparkle": line(canvas,12,3,12,21);line(canvas,3,12,21,12);line(canvas,6,6,18,18);line(canvas,18,6,6,18);break;
            case "chevron-right": line(canvas,9,5,16,12);line(canvas,16,12,9,19);break;
            case "chevron-down": line(canvas,5,9,12,16);line(canvas,12,16,19,9);break;
            case "codex": Path codex=new Path();codex.moveTo(7,5);codex.quadTo(12,2,17,5);codex.quadTo(22,8,19,14);codex.quadTo(17,20,12,21);codex.quadTo(7,20,5,14);codex.quadTo(2,8,7,5);canvas.drawPath(codex,paint);line(canvas,8,9,12,12);line(canvas,12,12,16,9);line(canvas,9,15,15,15);break;
            case "send": line(canvas,12,19,12,5); line(canvas,6,11,12,5); line(canvas,12,5,18,11); break;
            case "stop": canvas.drawRoundRect(6,6,18,18,2,2,paint); break;
            case "back": line(canvas,19,12,5,12); line(canvas,5,12,11,6); line(canvas,5,12,11,18); break;
            case "settings": canvas.drawCircle(12,12,4,paint); canvas.drawCircle(12,12,8,paint); for(int i=0;i<8;i++){double a=i*Math.PI/4; line(canvas,12+(float)Math.cos(a)*8,12+(float)Math.sin(a)*8,12+(float)Math.cos(a)*10,12+(float)Math.sin(a)*10);} break;
            default: line(canvas,9,6,15,12); line(canvas,15,12,9,18);
        }
        canvas.restore();
    }
    private void line(Canvas c,float x,float y,float a,float b){c.drawLine(x,y,a,b,paint);}
    @Override public void setAlpha(int alpha){paint.setAlpha(alpha);invalidateSelf();}
    @Override public void setColorFilter(ColorFilter filter){paint.setColorFilter(filter);}
    @Override public int getOpacity(){return PixelFormat.TRANSLUCENT;}
}
