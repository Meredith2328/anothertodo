package io.anothertodo.mobile;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import org.json.JSONArray;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;

public final class Data extends SQLiteOpenHelper {
    static final Object LOCK = new Object();
    private static Data instance;
    private final Context context;
    private Data(Context context) { super(context, "anothertodo.db", null, 1); this.context = context; }
    static Data get(Context context) {
        synchronized (LOCK) { if (instance == null) instance = new Data(context.getApplicationContext()); return instance; }
    }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, payload TEXT NOT NULL, config TEXT NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { throw new IllegalStateException("数据库版本无法识别"); }
    JSONObject load() throws Exception {
        synchronized (LOCK) {
            try (Cursor cursor = getReadableDatabase().rawQuery("SELECT version,payload FROM state WHERE id=1", null)) {
                if (!cursor.moveToFirst()) return new JSONObject().put("version", 0).put("state", JSONObject.NULL);
                return new JSONObject().put("version", cursor.getLong(0)).put("state", new JSONObject(cursor.getString(1)));
            }
        }
    }
    JSONObject config() throws Exception {
        synchronized (LOCK) {
            try (Cursor cursor = getReadableDatabase().rawQuery("SELECT config FROM state WHERE id=1", null)) {
                return cursor.moveToFirst() ? new JSONObject(cursor.getString(0)) : new JSONObject();
            }
        }
    }
    long save(long expected, JSONObject state, JSONObject config) throws Exception {
        synchronized (LOCK) {
            state.getJSONArray("tasks"); state.getJSONArray("archive"); state.getJSONArray("undo"); state.getString("config");
            SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
            try {
                long current = load().getLong("version");
                if (current != expected) throw new IllegalStateException("数据已发生变化，请重新打开任务后保存");
                ContentValues values = new ContentValues(); values.put("id", 1); values.put("version", current + 1);
                values.put("payload", state.toString()); values.put("config", config.toString());
                if (db.insertWithOnConflict("state", null, values, SQLiteDatabase.CONFLICT_REPLACE) == -1) throw new IllegalStateException("数据库写入失败");
                db.setTransactionSuccessful(); return current + 1;
            } finally { db.endTransaction(); }
        }
    }
    private SecretKey key() throws Exception {
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore"); keys.load(null);
        if (!keys.containsAlias("anothertodo-secrets")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("anothertodo-secrets", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey) keys.getKey("anothertodo-secrets", null);
    }
    void setSecret(String name, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String encoded = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!context.getSharedPreferences("secrets", 0).edit().putString(name, encoded).commit()) throw new IllegalStateException("加密设置保存失败");
    }
    String secret(String name, String initial) throws Exception {
        String raw = context.getSharedPreferences("secrets", 0).getString(name, null);
        if (raw == null) return initial;
        String[] parts = raw.split(":", 2); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }
    static boolean active(JSONObject task) { String status = task.optString("status"); return status.equals("todo") || status.equals("waiting") || status.equals("meeting"); }
    static boolean ready(JSONObject task, JSONObject state) throws Exception {
        JSONArray dependencies = task.optJSONArray("dependsOn"); if (dependencies == null || dependencies.length() == 0) return true;
        java.util.Map<String, String> statuses = new java.util.HashMap<>();
        for (String field : new String[]{"archive", "tasks"}) {
            JSONArray records = state.getJSONArray(field);
            for (int index = 0; index < records.length(); index++) { JSONObject record = records.getJSONObject(index); statuses.put(record.getString("id"), record.optBoolean("deleted") ? "deleted" : record.optString("status")); }
        }
        for (int index = 0; index < dependencies.length(); index++) if (!"done".equals(statuses.get(dependencies.getString(index)))) return false;
        return true;
    }
}
