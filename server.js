const express = require("express");
const cors = require("cors");

const workplaceRoutes = require("./routes/workplaceRoutes");
const clientRoutes = require("./routes/clientRoutes");
const loanRoutes = require("./routes/loanRoutes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Loan App API is running ✅");
});

// ✅ ROUTES
app.use("/workplaces", workplaceRoutes);
app.use("/clients", clientRoutes);
app.use("/", loanRoutes);

// ✅ IMPORTANT FIX (FOR RENDER)
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});