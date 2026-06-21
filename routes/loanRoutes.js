const express = require("express");
const router = express.Router();
const db = require("./db");

const {
  getLoanStatus,
  calculateDueDate,
  generateSchedule,
  updateScheduleAutomatically,
} = require("./loanUtils");

// POST /loans
router.post("/loans", (req, res) => {
  const { client_id, product, amount, interest, months, term, release_date } = req.body;

  const principal = Number(amount);
  const rate = Number(interest);
  const totalMonths = Number(months);

  if (
    !client_id ||
    !product ||
    Number.isNaN(principal) ||
    Number.isNaN(rate) ||
    Number.isNaN(totalMonths) ||
    !term ||
    !release_date
  ) {
    return res.status(400).send("Missing required fields");
  }

  // Interest is PER MONTH
  const totalInterest = principal * (rate / 100) * totalMonths;
  const totalPayable = principal + totalInterest;

  const dueDate = calculateDueDate(release_date, totalMonths, term);
  const status = getLoanStatus(totalPayable, dueDate);

  db.query(
    `INSERT INTO loans
    (client_id, product, amount, interest, months, term, release_date, due_date, total_payable, total_paid, balance, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      client_id,
      product,
      principal,
      rate,
      totalMonths,
      term,
      release_date,
      dueDate,
      totalPayable,
      0,
      totalPayable,
      status,
    ],
    (err, result) => {
      if (err) return res.status(500).send(err);

      generateSchedule(
        result.insertId,
        principal,
        rate,
        totalMonths,
        term,
        release_date
      );

      res.send({
        message: "Loan created successfully",
        loan_id: result.insertId,
      });
    }
  );
});

// GET /loans
router.get("/loans", async (req, res) => {
  try {
    // ✅ get loans using promise version
    const [loans] = await db.promise().query(`
      SELECT
        l.*,
        CONCAT(c.first_name, ' ', IFNULL(c.middle_name, ''), ' ', c.last_name) AS name
      FROM loans l
      JOIN clients c ON l.client_id = c.id
      ORDER BY l.id DESC
    `);

    // ✅ attach payments PER loan
    for (let loan of loans) {
      const [payments] = await db.promise().query(
        `SELECT 
          id,
          loan_id,
          payment_amount AS amount,
          payment_date
         FROM payments
         WHERE loan_id = ?
         ORDER BY payment_date DESC`,
        [loan.id]
      );

      loan.payments = payments;
    }

    res.json(loans);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});


// GET /loan-details/:loan_id
router.get("/loan-details/:loan_id", (req, res) => {
  const loanId = req.params.loan_id;

  db.query(
    `SELECT
      l.*,
      CONCAT(c.first_name, ' ', IFNULL(c.middle_name, ''), ' ', c.last_name) AS client_name
     FROM loans l
     JOIN clients c ON l.client_id = c.id
     WHERE l.id = ?`,
    [loanId],
    (err, result) => {
      if (err) return res.status(500).send(err);
      if (result.length === 0) return res.status(404).send("Loan not found");

      const loan = result[0];

      db.query(
        `SELECT
          COUNT(*) AS total_installments,
          SUM(CASE WHEN status = 'Paid' THEN 1 ELSE 0 END) AS installments_paid,
          SUM(CASE WHEN status = 'Partial' THEN 1 ELSE 0 END) AS partial_installments,
          MIN(CASE WHEN status != 'Paid' THEN due_date END) AS next_due_date
         FROM schedules
         WHERE loan_id = ?`,
        [loanId],
        (schedErr, schedResult) => {
          if (schedErr) return res.status(500).send(schedErr);

          res.send({
            ...loan,
            ...schedResult[0],
          });
        }
      );
    }
  );
});

// POST /loans/:id/pay
router.post("/loans/:id/pay", (req, res) => {
  const loanId = req.params.id;
  const payment = Number(req.body.payment_amount);

  if (!payment || payment <= 0) {
    return res.status(400).send("Invalid payment amount");
  }

  db.query("SELECT * FROM loans WHERE id = ?", [loanId], (err, result) => {
    if (err) return res.status(500).send(err);
    if (result.length === 0) return res.status(404).send("Loan not found");

    const loan = result[0];
    const currentBalance = Number(loan.balance);
    const currentPaid = Number(loan.total_paid || 0);

    if (currentBalance <= 0) {
      return res.status(400).send("Loan is already fully paid");
    }

    if (payment > currentBalance) {
      return res.status(400).send("Payment exceeds remaining balance");
    }

    const newTotalPaid = currentPaid + payment;
    const newBalance = currentBalance - payment;
    const newStatus = getLoanStatus(newBalance, loan.due_date);

    db.query(
      "UPDATE loans SET total_paid = ?, balance = ?, status = ? WHERE id = ?",
      [newTotalPaid, newBalance, newStatus, loanId],
      (updateErr) => {
        if (updateErr) return res.status(500).send(updateErr);

        db.query(
          "INSERT INTO payments (loan_id, payment_amount) VALUES (?, ?)",
          [loanId, payment],
          (payErr) => {
            if (payErr) return res.status(500).send(payErr);

            updateScheduleAutomatically(loanId, payment, (scheduleErr) => {
              if (scheduleErr) return res.status(500).send(scheduleErr);

              res.send({
                message: "Payment recorded successfully",
                total_paid: newTotalPaid,
                balance: newBalance,
                status: newStatus,
              });
            });
          }
        );
      }
    );
  });
});

// GET /payments/:loan_id
router.get("/payments/:loan_id", (req, res) => {
  const loanId = req.params.loan_id;

  db.query(
    "SELECT * FROM payments WHERE loan_id = ? ORDER BY id DESC",
    [loanId],
    (err, result) => {
      if (err) return res.status(500).send(err);
      res.send(result);
    }
  );
});

// GET /schedules/:loan_id
router.get("/schedules/:loan_id", (req, res) => {
  const loanId = req.params.loan_id;

  db.query(
    "SELECT * FROM schedules WHERE loan_id = ? ORDER BY due_date ASC, id ASC",
    [loanId],
    (err, result) => {
      if (err) return res.status(500).send(err);

      const today = new Date();

      const updated = result.map((row) => {
        let status = row.status;

        if (status !== "Paid") {
          const due = new Date(row.due_date);
          if (today > due && Number(row.paid_amount || 0) < Number(row.amount)) {
            status = "Overdue";
          }
        }

        return {
          ...row,
          status,
        };
      });

      res.send(updated);
    }
  );
});

module.exports = router;