import express from "express";
import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";

const app = express();app.use(express.static('public'));
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || "./data/app.db";

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);
}); 

app.use(express.json());


app.get("/api/status", (req, res) => {
  res.json({ system: "running" });
});

app.get("/api/projects", (req, res) => {
  res.json({
    layout: [
      { type: "heading", content: "WamuHub is live" },
      { type: "button", content: "Tap me" }
    ]
  });
});

app.get("/api/items/create-test", (req, res) => {
  const text = "First item";
  const createdAt = new Date().toISOString();

  db.run(
    "INSERT INTO items (text, createdAt) VALUES (?, ?)",
    [text, createdAt],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "database write failed" });
      }

      res.json({
        item: {
          id: this.lastID,
          text,
          createdAt
        }
      });
    }
  );
});

app.get("/api/items", (req, res) => {
  db.all(
    "SELECT id, text, createdAt FROM items ORDER BY id DESC",
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "database read failed" });
      }

      res.json({ items: rows });
    }
  );
});

app.post("/api/items", (req, res) => {
  const text = String(req.body?.text || "").trim();

  if (!text) {
    return res.status(400).json({ error: "text is required" });
  }

  const createdAt = new Date().toISOString();

  db.run(
    "INSERT INTO items (text, createdAt) VALUES (?, ?)",
    [text, createdAt],
    function (err) {
      if (err) {
        return res.status(500).json({ error: "database write failed" });
      }

      res.status(201).json({
        item: {
          id: this.lastID,
          text,
          createdAt
        }
      });
    }
  );
});
// list items

app.delete("/api/items/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "invalid id" });
  }

  db.run("DELETE FROM items WHERE id = ?", [id], function (err) {
    if (err) {
      return res.status(500).json({ error: "database delete failed" });
    }

    if (this.changes === 0) {
      return res.status(404).json({ error: "item not found" });
    }

    res.json({ ok: true });
  });
});
app.get('/time', (req, res) => res.json({ now: new Date().toISOString() }));
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});