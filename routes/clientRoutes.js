const express = require("express");
const router = express.Router();
const db = require("./db");

// POST /clients
router.post("/", (req, res) => {
  const {
    first_name,
    middle_name,
    last_name,
    address,
    cp_number,
    workplace_id,
  } = req.body;

  if (!first_name || !last_name || !address || !cp_number || !workplace_id) {
    return res.status(400).send("Please fill in all required fields");
  }

  db.query(
    `INSERT INTO clients
    (first_name, middle_name, last_name, address, cp_number, workplace_id)
    VALUES (?, ?, ?, ?, ?, ?)`,
    [
      first_name,
      middle_name || "",
      last_name,
      address,
      cp_number,
      workplace_id,
    ],
    (err, result) => {
      if (err) return res.status(500).send(err);

      res.send({
        message: "Client added successfully",
        result,
      });
    }
  );
});

// GET /clients
router.get("/", (req, res) => {
  db.query(
    `SELECT
      c.id,
      c.first_name,
      c.middle_name,
      c.last_name,
      c.address,
      c.cp_number,
      c.workplace_id,
      w.workplace_name,
      CONCAT(c.first_name, ' ', IFNULL(c.middle_name, ''), ' ', c.last_name) AS name,
      COALESCE(SUM(l.balance), 0) AS outstanding_balance
    FROM clients c
    LEFT JOIN workplaces w ON c.workplace_id = w.id
    LEFT JOIN loans l ON c.id = l.client_id
    GROUP BY
      c.id,
      c.first_name,
      c.middle_name,
      c.last_name,
      c.address,
      c.cp_number,
      c.workplace_id,
      w.workplace_name
    ORDER BY c.id DESC`,
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send(result);
    }
  );
});

// PUT /clients/:id
router.put("/:id", (req, res) => {
  const clientId = req.params.id;
  const {
    first_name,
    middle_name,
    last_name,
    address,
    cp_number,
    workplace_id,
  } = req.body;

  if (!first_name || !last_name || !address || !cp_number || !workplace_id) {
    return res.status(400).send("Please fill in all required fields");
  }

  db.query(
    `UPDATE clients
     SET first_name = ?, middle_name = ?, last_name = ?, address = ?, cp_number = ?, workplace_id = ?
     WHERE id = ?`,
    [
      first_name,
      middle_name || "",
      last_name,
      address,
      cp_number,
      workplace_id,
      clientId,
    ],
    (err) => {
      if (err) return res.status(500).send(err);

      res.send({
        message: "Client updated successfully",
      });
    }
  );
});

// DELETE /clients/:id
router.delete("/:id", (req, res) => {
  const clientId = req.params.id;

  db.query(
    "SELECT COALESCE(SUM(balance), 0) AS outstanding_balance FROM loans WHERE client_id = ?",
    [clientId],
    (err, result) => {
      if (err) return res.status(500).send(err);

      const outstandingBalance = Number(result[0].outstanding_balance);

      if (outstandingBalance > 0) {
        return res.status(400).send("Cannot delete client with outstanding loan");
      }

      db.query(
        "SELECT id FROM loans WHERE client_id = ?",
        [clientId],
        (err2, loans) => {
          if (err2) return res.status(500).send(err2);

          const loanIds = loans.map((loan) => loan.id);

          const deleteClientOnly = () => {
            db.query(
              "DELETE FROM clients WHERE id = ?",
              [clientId],
              (err5) => {
                if (err5) return res.status(500).send(err5);

                res.send({
                  message: "Client deleted successfully",
                });
              }
            );
          };

          if (loanIds.length === 0) {
            return deleteClientOnly();
          }

          db.query(
            "DELETE FROM schedules WHERE loan_id IN (?)",
            [loanIds],
            (err3) => {
              if (err3) return res.status(500).send(err3);

              db.query(
                "DELETE FROM payments WHERE loan_id IN (?)",
                [loanIds],
                (err4) => {
                  if (err4) return res.status(500).send(err4);

                  db.query(
                    "DELETE FROM loans WHERE client_id = ?",
                    [clientId],
                    (err5) => {
                      if (err5) return res.status(500).send(err5);
                      deleteClientOnly();
                    }
                  );
                }
              );
            }
          );
        }
      );
    }
  );
});

module.exports = router;
