const express = require("express");
const router = express.Router();
const db = require("./db");

// GET /workplaces
router.get("/", (req, res) => {
  db.query(
    "SELECT id, workplace_name FROM workplaces ORDER BY workplace_name ASC",
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send(result);
    }
  );
});

// POST /workplaces
router.post("/", (req, res) => {
  const { workplace_name } = req.body;

  if (!workplace_name || !workplace_name.trim()) {
    return res.status(400).send("Workplace name is required");
  }

  db.query(
    "INSERT INTO workplaces (workplace_name) VALUES (?)",
    [workplace_name.trim()],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send({
        message: "Workplace added successfully",
        result,
      });
    }
  );
});

module.exports = router;