package app.porch.team;

import android.app.Activity;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Build;
import android.os.Environment;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.Locale;

/** Reads MyBible modules the owner pasted in Download/Porchbook. Nothing is uploaded. */
final class BibleModules {
    private static final String[] NAMES = {
            "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
            "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah",
            "Esther", "Job", "Psalms", "Proverbs", "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah",
            "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos", "Obadiah", "Jonah", "Micah",
            "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew", "Mark", "Luke",
            "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians",
            "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon",
            "Hebrews", "James", "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation"
    };

    private BibleModules() {}

    static File folder() {
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        return new File(downloads, "Porchbook");
    }

    static boolean canRead(Activity activity) {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return activity.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED
                || Build.VERSION.SDK_INT < 23;
    }

    static String list() {
        JSONArray arr = new JSONArray();
        File[] files = folder().listFiles();
        if (files == null) return "[]";
        java.util.Arrays.sort(files, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
        for (File file : files) {
            if (!isBible(file)) continue;
            try {
                JSONObject item = new JSONObject();
                item.put("file", file.getName());
                item.put("title", titleOf(file));
                arr.put(item);
            } catch (Exception ignored) {
                // Skip a module the phone cannot describe.
            }
        }
        return arr.toString();
    }

    static String books(String name) {
        File file = resolve(name);
        if (file == null) return "{\"ok\":false,\"error\":\"That module is not in Download/Porchbook.\"}";
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            String bookCol = column(db, "verses", "book_number", "book");
            String chapterCol = column(db, "verses", "chapter");
            if (bookCol == null || chapterCol == null) return "{\"ok\":false,\"error\":\"That file is not a Bible module.\"}";
            java.util.Map<Integer, String> names = bookNames(db);
            java.util.Map<Integer, Integer> chapters = new java.util.LinkedHashMap<>();
            Cursor cursor = db.rawQuery("SELECT " + bookCol + ", MAX(" + chapterCol + ") FROM verses GROUP BY " + bookCol + " ORDER BY " + bookCol, null);
            while (cursor.moveToNext()) chapters.put(cursor.getInt(0), cursor.getInt(1));
            cursor.close();
            JSONArray arr = new JSONArray();
            for (java.util.Map.Entry<Integer, Integer> entry : chapters.entrySet()) {
                JSONObject item = new JSONObject();
                item.put("number", entry.getKey());
                item.put("name", names.getOrDefault(entry.getKey(), fallbackName(entry.getKey())));
                item.put("chapters", Math.max(1, entry.getValue()));
                arr.put(item);
            }
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("books", arr);
            return out.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"That module did not open.\"}";
        } finally {
            if (db != null) db.close();
        }
    }

    static String chapter(String name, int book, int chapter) {
        File file = resolve(name);
        if (file == null) return "{\"ok\":false,\"error\":\"That module is not in Download/Porchbook.\"}";
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            String bookCol = column(db, "verses", "book_number", "book");
            String chapterCol = column(db, "verses", "chapter");
            String verseCol = column(db, "verses", "verse");
            String textCol = column(db, "verses", "text");
            if (bookCol == null || chapterCol == null || verseCol == null || textCol == null) {
                return "{\"ok\":false,\"error\":\"That file is not a Bible module.\"}";
            }
            Cursor cursor = db.rawQuery(
                    "SELECT " + verseCol + ", " + textCol + " FROM verses WHERE " + bookCol + "=? AND " + chapterCol + "=? ORDER BY " + verseCol,
                    new String[] { String.valueOf(book), String.valueOf(chapter) }
            );
            JSONArray arr = new JSONArray();
            while (cursor.moveToNext()) {
                JSONObject item = new JSONObject();
                item.put("verse", String.valueOf(cursor.getInt(0)));
                item.put("text", plain(cursor.getString(1)));
                arr.put(item);
            }
            cursor.close();
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("verses", arr);
            return out.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"That chapter did not open.\"}";
        } finally {
            if (db != null) db.close();
        }
    }

    static String search(String name, String query) {
        File file = resolve(name);
        if (file == null) return "{\"ok\":false,\"error\":\"That module is not in Download/Porchbook.\"}";
        String term = query == null ? "" : query.trim();
        if (term.length() < 2) return "{\"ok\":false,\"error\":\"Write a word or a phrase.\"}";
        if (term.length() > 60) term = term.substring(0, 60);
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            String bookCol = column(db, "verses", "book_number", "book");
            String chapterCol = column(db, "verses", "chapter");
            String verseCol = column(db, "verses", "verse");
            String textCol = column(db, "verses", "text");
            if (bookCol == null || textCol == null) return "{\"ok\":false,\"error\":\"That file is not a Bible module.\"}";
            java.util.Map<Integer, String> names = bookNames(db);
            String like = "%" + term.replace("%", "").replace("_", "") + "%";
            Cursor cursor = db.rawQuery(
                    "SELECT " + bookCol + ", " + chapterCol + ", " + verseCol + ", " + textCol + " FROM verses WHERE " + textCol + " LIKE ? LIMIT 40",
                    new String[] { like }
            );
            JSONArray arr = new JSONArray();
            while (cursor.moveToNext()) {
                JSONObject item = new JSONObject();
                int number = cursor.getInt(0);
                item.put("number", number);
                item.put("name", names.getOrDefault(number, fallbackName(number)));
                item.put("chapter", cursor.getInt(1));
                item.put("verse", cursor.getInt(2));
                item.put("text", plain(cursor.getString(3)));
                arr.put(item);
            }
            cursor.close();
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("hits", arr);
            return out.toString();
        } catch (Exception ignored) {
            return "{\"ok\":false,\"error\":\"The search did not open.\"}";
        } finally {
            if (db != null) db.close();
        }
    }

    private static boolean isBible(File file) {
        if (file == null || !file.isFile()) return false;
        String name = file.getName().toLowerCase(Locale.US);
        if (!name.endsWith(".sqlite3") && !name.endsWith(".sqlite")) return false;
        return !name.contains(".dictionary") && !name.contains(".commentaries") && !name.contains(".crossreferences") && !name.contains(".subheadings");
    }

    private static File resolve(String name) {
        if (name == null || name.contains("/") || name.contains("\\") || name.contains("..")) return null;
        File file = new File(folder(), name);
        if (!isBible(file)) return null;
        try {
            String root = folder().getCanonicalPath();
            String path = file.getCanonicalPath();
            if (!path.startsWith(root + File.separator)) return null;
        } catch (Exception ignored) {
            return null;
        }
        return file;
    }

    private static String titleOf(File file) {
        String base = file.getName().replaceAll("(?i)\\.sqlite3$", "").replaceAll("(?i)\\.sqlite$", "");
        SQLiteDatabase db = null;
        try {
            db = SQLiteDatabase.openDatabase(file.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY);
            String value = info(db, "description");
            if (value == null || value.isEmpty()) value = info(db, "short_name");
            if (value != null && !value.isEmpty() && value.length() <= 28) return value;
        } catch (Exception ignored) {
            // The file name is enough for the spine.
        } finally {
            if (db != null) db.close();
        }
        return base.length() > 28 ? base.substring(0, 28) : base;
    }

    private static String info(SQLiteDatabase db, String key) {
        if (!hasTable(db, "info")) return "";
        Cursor cursor = db.rawQuery("SELECT value FROM info WHERE name=? LIMIT 1", new String[] { key });
        String value = cursor.moveToFirst() ? cursor.getString(0) : "";
        cursor.close();
        return value == null ? "" : value.trim();
    }

    private static java.util.Map<Integer, String> bookNames(SQLiteDatabase db) {
        java.util.Map<Integer, String> names = new java.util.HashMap<>();
        if (!hasTable(db, "books")) return names;
        String numberCol = column(db, "books", "book_number", "book");
        String nameCol = column(db, "books", "long_name", "short_name", "name");
        if (numberCol == null || nameCol == null) return names;
        Cursor cursor = db.rawQuery("SELECT " + numberCol + ", " + nameCol + " FROM books", null);
        while (cursor.moveToNext()) {
            String name = cursor.getString(1);
            if (name != null && !name.trim().isEmpty()) names.put(cursor.getInt(0), name.trim());
        }
        cursor.close();
        return names;
    }

    private static String fallbackName(int number) {
        int index = number >= 10 && number % 10 == 0 ? (number / 10) - 1 : number - 1;
        if (index >= 0 && index < NAMES.length) return NAMES[index];
        return "Book " + number;
    }

    private static boolean hasTable(SQLiteDatabase db, String table) {
        Cursor cursor = db.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1", new String[] { table });
        boolean found = cursor.moveToFirst();
        cursor.close();
        return found;
    }

    private static String column(SQLiteDatabase db, String table, String... wanted) {
        if (!hasTable(db, table)) return null;
        Cursor cursor = db.rawQuery("PRAGMA table_info(" + table + ")", null);
        java.util.Set<String> have = new java.util.HashSet<>();
        while (cursor.moveToNext()) have.add(cursor.getString(1).toLowerCase(Locale.US));
        cursor.close();
        for (String name : wanted) {
            if (have.contains(name.toLowerCase(Locale.US))) return name;
        }
        return null;
    }

    private static String plain(String value) {
        if (value == null) return "";
        String text = value.replaceAll("(?i)<sup>[\\s\\S]*?</sup>", "");
        text = text.replaceAll("(?i)<S>\\d+</S>", "");
        text = text.replaceAll("<[^>]+>", "");
        text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", "\"");
        return text.replaceAll("\\s+", " ").trim();
    }
}
