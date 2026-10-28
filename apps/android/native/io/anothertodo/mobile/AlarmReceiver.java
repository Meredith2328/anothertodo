package io.anothertodo.mobile;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import android.content.pm.PackageManager;
import android.util.Log;
import org.json.JSONObject;
import org.json.JSONArray;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.Instant;
import java.util.Properties;
import java.util.UUID;
import java.net.URL;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;
import java.io.OutputStream;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.Message;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

public final class AlarmReceiver extends BroadcastReceiver {
    private static final String CHANNEL = "task-reminders";
    private static PendingIntent alarm(Context context) {
        return PendingIntent.getBroadcast(context, 1, new Intent(context, AlarmReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
    private static long epoch(String text) {
        if (text.endsWith("Z") || text.matches(".*[+-]\\d\\d:\\d\\d$")) return OffsetDateTime.parse(text).toInstant().toEpochMilli();
        return LocalDateTime.parse(text).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
    }
    static void schedule(Context context) throws Exception {
        synchronized (Data.LOCK) {
            NotificationManager notifications = context.getSystemService(NotificationManager.class);
            notifications.createNotificationChannel(new NotificationChannel(CHANNEL, "任务提醒", NotificationManager.IMPORTANCE_HIGH));
            AlarmManager manager = context.getSystemService(AlarmManager.class); manager.cancel(alarm(context));
            if (Build.VERSION.SDK_INT >= 31 && !manager.canScheduleExactAlarms()) return;
            JSONObject snapshot = Data.get(context).load();
            if (snapshot.isNull("state")) return;
            long nearest = Long.MAX_VALUE; JSONArray tasks = snapshot.getJSONObject("state").getJSONArray("tasks");
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject task = tasks.getJSONObject(i); if (!Data.active(task) || !Data.ready(task, snapshot.getJSONObject("state"))) continue;
                JSONArray reminders = task.getJSONArray("reminders");
                for (int j = 0; j < reminders.length(); j++) {
                    JSONObject reminder = reminders.getJSONObject(j); if (reminder.optBoolean("fired") || reminder.optBoolean("dead")) continue;
                    long at = epoch(reminder.getString("at"));
                    if (reminder.has("leaseUntil")) at = Math.max(at, epoch(reminder.getString("leaseUntil")));
                    nearest = Math.min(nearest, at);
                }
            }
            if (nearest != Long.MAX_VALUE) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, Math.max(nearest, System.currentTimeMillis() + 1000), alarm(context));
        }
    }
    @Override public void onReceive(Context context, Intent intent) {
        PendingResult pending = goAsync();
        PowerManager.WakeLock wake = context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AnotherTODO:reminders"); wake.acquire(120000);
        new Thread(() -> {
            try {
                if ("snooze".equals(intent.getAction())) snooze(context, intent.getStringExtra("task"), intent.getStringExtra("reminder"));
                else deliverDue(context);
                schedule(context);
            } catch (Exception error) { Log.e("AnotherTODO", "后台提醒执行失败", error); throw new IllegalStateException(error); }
            finally { if (wake.isHeld()) wake.release(); pending.finish(); }
        }, "atd-reminders").start();
    }
    private static JSONObject findReminder(JSONObject state, String taskId, String reminderId) throws Exception {
        JSONArray tasks = state.getJSONArray("tasks");
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject task = tasks.getJSONObject(i); if (!task.optString("id").equals(taskId) || !Data.active(task)) continue;
            JSONArray reminders = task.getJSONArray("reminders");
            for (int j = 0; j < reminders.length(); j++) if (reminders.getJSONObject(j).optString("id").equals(reminderId)) return reminders.getJSONObject(j);
        }
        return null;
    }
    private static void snooze(Context context, String taskId, String reminderId) throws Exception {
        synchronized (Data.LOCK) {
            Data data = Data.get(context); JSONObject snapshot = data.load(); if (snapshot.isNull("state")) return;
            JSONObject state = snapshot.getJSONObject("state"); JSONObject reminder = findReminder(state, taskId, reminderId); if (reminder == null) return;
            reminder.put("at", LocalDateTime.now().plusMinutes(10).toString()).put("fired", false).put("dead", false).put("attempts", 0);
            reminder.remove("leaseOwner"); reminder.remove("leaseUntil"); data.save(snapshot.getLong("version"), state, data.config());
            context.getSystemService(NotificationManager.class).cancel((taskId + reminderId).hashCode());
        }
    }
    private static void deliverDue(Context context) throws Exception {
        Data data = Data.get(context); JSONObject snapshot = data.load(); if (snapshot.isNull("state")) return;
        JSONArray tasks = snapshot.getJSONObject("state").getJSONArray("tasks");
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject task = tasks.getJSONObject(i); if (!Data.active(task) || !Data.ready(task, snapshot.getJSONObject("state"))) continue;
            JSONArray reminders = task.getJSONArray("reminders");
            for (int j = 0; j < reminders.length(); j++) {
                JSONObject original = reminders.getJSONObject(j);
                if (original.optBoolean("fired") || original.optBoolean("dead") || epoch(original.getString("at")) > System.currentTimeMillis()) continue;
                String taskId = task.getString("id"), reminderId = original.getString("id"), owner = UUID.randomUUID().toString();
                JSONObject claim;
                synchronized (Data.LOCK) {
                    JSONObject current = data.load(); JSONObject state = current.getJSONObject("state");
                    JSONObject reminder = findReminder(state, taskId, reminderId);
                    boolean ready = false;
                    JSONArray currentTasks = state.getJSONArray("tasks");
                    for (int k = 0; k < currentTasks.length(); k++) { JSONObject currentTask = currentTasks.getJSONObject(k); if (currentTask.optString("id").equals(taskId)) { ready = Data.ready(currentTask, state); break; } }
                    if (!ready) continue;
                    if (reminder == null || reminder.optBoolean("fired") || reminder.optBoolean("dead") || epoch(reminder.getString("at")) > System.currentTimeMillis()
                        || (reminder.has("leaseUntil") && epoch(reminder.getString("leaseUntil")) > System.currentTimeMillis())) continue;
                    reminder.put("leaseOwner", owner).put("leaseUntil", Instant.now().plusSeconds(180).toString());
                    data.save(current.getLong("version"), state, data.config()); claim = new JSONObject(reminder.toString());
                    schedule(context);
                }
                boolean delivered = false; JSONArray hooks = claim.getJSONArray("hooks");
                for (int k = 0; k < hooks.length(); k++) {
                    String hook = hooks.getString(k);
                    try {
                        if (hook.equals("toast")) notify(context, task, claim);
                        else if (hook.equals("email")) email(task, data.config().getJSONObject("email"));
                        else webhook(task, hook, new JSONObject(data.secret("hooks", "{}")));
                        delivered = true;
                    } catch (Exception error) { Log.e("AnotherTODO", "通知方式投递失败：" + hook, error); }
                }
                synchronized (Data.LOCK) {
                    JSONObject current = data.load(); JSONObject state = current.getJSONObject("state"); JSONObject reminder = findReminder(state, taskId, reminderId);
                    if (reminder == null || !owner.equals(reminder.optString("leaseOwner"))) continue;
                    reminder.remove("leaseOwner"); reminder.remove("leaseUntil");
                    int attempts = reminder.optInt("attempts") + 1; reminder.put("attempts", attempts);
                    if (delivered) reminder.put("fired", true);
                    else if (attempts >= 3) reminder.put("dead", true);
                    else reminder.put("at", LocalDateTime.now().plusMinutes(1L << attempts).toString());
                    data.save(current.getLong("version"), state, data.config());
                    Log.i("AnotherTODO", "提醒投递：" + taskId + " fired=" + delivered + " attempts=" + attempts);
                }
            }
        }
    }
    private static void notify(Context context, JSONObject task, JSONObject reminder) throws Exception {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (!manager.areNotificationsEnabled() || (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED)) throw new IllegalStateException("系统通知权限尚未开启");
        String taskId = task.getString("id"), reminderId = reminder.getString("id"); int id = (taskId + reminderId).hashCode();
        PendingIntent open = PendingIntent.getActivity(context, id, new Intent(context, MainActivity.class).putExtra("task", taskId), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent snooze = PendingIntent.getBroadcast(context, id, new Intent(context, AlarmReceiver.class).setAction("snooze").putExtra("task", taskId).putExtra("reminder", reminderId), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean missed = System.currentTimeMillis() - epoch(reminder.getString("at")) > 90000;
        Notification notification = new Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle((missed ? "[错过] " : "") + task.getString("title")).setContentText(task.optString("notes", task.optString("due")))
            .setStyle(new Notification.BigTextStyle().bigText(task.optString("notes", task.optString("due"))))
            .setContentIntent(open).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER)
            .addAction(new Notification.Action.Builder(null, "推迟十分钟", snooze).build()).build();
        manager.notify(id, notification);
    }
    private static void email(JSONObject task, JSONObject config) throws Exception {
        String host = config.getString("host"); if (host.isEmpty()) throw new IllegalStateException("请填写邮件服务器配置");
        Properties settings = new Properties(); settings.setProperty("mail.smtp.host", host); settings.setProperty("mail.smtp.port", String.valueOf(config.getInt("port")));
        settings.setProperty("mail.smtp.auth", "true"); settings.setProperty("mail.smtp.ssl.enable", String.valueOf(config.getBoolean("ssl")));
        settings.setProperty("mail.smtp.ssl.checkserveridentity", "true");
        if (!config.getBoolean("ssl")) settings.setProperty("mail.smtp.starttls.enable", "true");
        settings.setProperty("mail.smtp.connectiontimeout", "12000"); settings.setProperty("mail.smtp.timeout", "12000"); settings.setProperty("mail.smtp.writetimeout", "12000");
        Session session = Session.getInstance(settings); MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress(config.getString("from"))); message.setRecipients(Message.RecipientType.TO, InternetAddress.parse(config.getString("to")));
        message.setSubject("AnotherTODO · " + task.getString("title"), "UTF-8"); message.setText(task.getString("title") + "\n" + task.optString("due") + "\n\n" + task.optString("notes"), "UTF-8");
        try (Transport transport = session.getTransport("smtp")) { transport.connect(host, config.getInt("port"), config.getString("user"), config.getString("password")); transport.sendMessage(message, message.getAllRecipients()); }
    }
    private static void webhook(JSONObject task, String hook, JSONObject hooks) throws Exception {
        URL url = new URL(hooks.getString(hook)); if (!url.getProtocol().equals("https")) throw new SecurityException("通知地址需要 HTTPS");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection(); connection.setConnectTimeout(12000); connection.setReadTimeout(12000); connection.setInstanceFollowRedirects(false);
        connection.setRequestMethod("POST"); connection.setRequestProperty("Content-Type", "application/json; charset=utf-8"); connection.setDoOutput(true);
        try { try (OutputStream output = connection.getOutputStream()) { output.write(task.toString().getBytes(StandardCharsets.UTF_8)); } int code = connection.getResponseCode(); if (code < 200 || code >= 300) throw new java.io.IOException("通知接口返回 " + code); }
        finally { connection.disconnect(); }
    }
}
