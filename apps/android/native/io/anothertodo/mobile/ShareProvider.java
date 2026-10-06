package io.anothertodo.mobile;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public final class ShareProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    private File file(Uri uri) throws FileNotFoundException {
        try {
            File root = new File(getContext().getCacheDir(), "exports").getCanonicalFile();
            File file = new File(root, uri.getLastPathSegment()).getCanonicalFile();
            if (!file.getParentFile().equals(root) || !file.isFile()) throw new FileNotFoundException("分享文件不存在");
            return file;
        } catch (java.io.IOException error) { throw new FileNotFoundException(error.getMessage()); }
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!mode.equals("r")) throw new SecurityException("分享文件只支持读取");
        return ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sortOrder) {
        try { File file = file(uri); MatrixCursor result = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}); result.addRow(new Object[]{file.getName(), file.length()}); return result; }
        catch (FileNotFoundException error) { throw new IllegalArgumentException(error); }
    }
    @Override public String getType(Uri uri) { return uri.toString().endsWith(".json") ? "application/json" : "text/plain"; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException(); }
}
