const db = require("./db");

function getLoanStatus(balance, dueDate) {
  const bal = Number(balance || 0);
  const today = new Date();
  const due = dueDate ? new Date(dueDate) : null;

  if (bal <= 0) return "Paid";
  if (due && today > due && bal > 0) return "Overdue";
  return "Active";
}

function calculateDueDate(releaseDate, months, term) {
  const totalMonths = Number(months);
  let currentDate = new Date(releaseDate);
  let payments = 0;

  if (term === "Weekly") {
    payments = totalMonths * 4;
  } else if (term === "Semi-Monthly") {
    payments = totalMonths * 2;
  } else {
    payments = totalMonths;
  }

  for (let i = 0; i < payments; i++) {
    if (term === "Weekly") {
      currentDate.setDate(currentDate.getDate() + 7);
    } else if (term === "Semi-Monthly") {
      currentDate.setDate(currentDate.getDate() + 15);
    } else {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }
  }

  return currentDate.toISOString().split("T")[0];
}

function generateSchedule(loanId, amount, interest, months, term, releaseDate) {
  const principal = Number(amount);
  const rate = Number(interest);
  const totalMonths = Number(months);

  // Interest is PER MONTH
  const totalInterest = principal * (rate / 100) * totalMonths;
  const totalPayable = principal + totalInterest;

  let payments = 0;

  if (term === "Weekly") {
    payments = totalMonths * 4;
  } else if (term === "Semi-Monthly") {
    payments = totalMonths * 2;
  } else {
    payments = totalMonths;
  }

  if (payments <= 0) return;

  const installment = (totalPayable / payments).toFixed(2);
  let currentDate = new Date(releaseDate);

  for (let i = 0; i < payments; i++) {
    if (term === "Weekly") {
      currentDate.setDate(currentDate.getDate() + 7);
    } else if (term === "Semi-Monthly") {
      currentDate.setDate(currentDate.getDate() + 15);
    } else {
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    const dueDate = currentDate.toISOString().split("T")[0];

    db.query(
      "INSERT INTO schedules (loan_id, due_date, amount, paid_amount, status) VALUES (?, ?, ?, ?, ?)",
      [loanId, dueDate, installment, 0, "Pending"],
      (err) => {
        if (err) {
          console.error("Error inserting schedule:", err);
        }
      }
    );
  }
}

function updateScheduleAutomatically(loanId, paymentAmount, callback) {
  let remainingPayment = Number(paymentAmount);

  db.query(
    "SELECT * FROM schedules WHERE loan_id = ? AND status != 'Paid' ORDER BY due_date ASC, id ASC",
    [loanId],
    (err, schedules) => {
      if (err) return callback(err);

      if (!schedules.length) return callback(null);

      const processSchedule = (index) => {
        if (index >= schedules.length || remainingPayment <= 0) {
          return callback(null);
        }

        const sched = schedules[index];
        const schedAmount = Number(sched.amount);
        const alreadyPaid = Number(sched.paid_amount || 0);
        const remainingSchedBalance = schedAmount - alreadyPaid;

        if (remainingSchedBalance <= 0) {
          return processSchedule(index + 1);
        }

        if (remainingPayment >= remainingSchedBalance) {
          const newPaidAmount = alreadyPaid + remainingSchedBalance;
          remainingPayment -= remainingSchedBalance;

          db.query(
            "UPDATE schedules SET paid_amount = ?, status = 'Paid' WHERE id = ?",
            [newPaidAmount, sched.id],
            (updateErr) => {
              if (updateErr) return callback(updateErr);
              processSchedule(index + 1);
            }
          );
        } else {
          const newPaidAmount = alreadyPaid + remainingPayment;

          db.query(
            "UPDATE schedules SET paid_amount = ?, status = 'Partial' WHERE id = ?",
            [newPaidAmount, sched.id],
            (updateErr) => {
              if (updateErr) return callback(updateErr);
              remainingPayment = 0;
              callback(null);
            }
          );
        }
      };

      processSchedule(0);
    }
  );
}

module.exports = {
  getLoanStatus,
  calculateDueDate,
  generateSchedule,
  updateScheduleAutomatically,
};
